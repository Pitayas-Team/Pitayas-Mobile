import Foundation
import Network
import Capacitor

// ═══════ PITAYAS USB ═══════
// iPhone nie ma „adb reverse”, więc to komputer łączy się z telefonem: przez kabel (usbmuxd) do portu na iPhonie.
// Ta wtyczka słucha WebSocketów TYLKO na 127.0.0.1 telefonu (z Wi-Fi nikt się nie połączy) i przekazuje wiadomości
// między dwiema stronami: komputerem ({"role":"pc"}) i modułem w aplikacji ({"role":"app"}).
@objc(PitayasUsbPlugin)
public class PitayasUsbPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PitayasUsbPlugin"
    public let jsName = "PitayasUsb"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "pitayas.usb")
    private var listener: NWListener?
    private var port: UInt16 = 0
    private var pc: NWConnection?
    private var app: NWConnection?

    @objc func start(_ call: CAPPluginCall) {
        let wanted = UInt16(call.getInt("port") ?? 8195)
        queue.async {
            if self.listener != nil, self.port == wanted { call.resolve(["port": Int(wanted)]); return }
            self.stopAll()
            do {
                let ws = NWProtocolWebSocket.Options()
                ws.autoReplyPing = true
                ws.maximumMessageSize = 32 * 1024 * 1024
                let params = NWParameters.tcp
                params.defaultProtocolStack.applicationProtocols.insert(ws, at: 0)
                params.allowLocalEndpointReuse = true
                params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: wanted)!)
                let l = try NWListener(using: params)
                l.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
                l.stateUpdateHandler = { [weak self] st in
                    if case .failed(let err) = st { self?.notifyListeners("state", data: ["error": err.localizedDescription]) }
                }
                l.start(queue: self.queue)
                self.listener = l
                self.port = wanted
                call.resolve(["port": Int(wanted)])
            } catch {
                call.reject("Nie mogę nasłuchiwać na porcie \(wanted): \(error.localizedDescription)")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        queue.async { self.stopAll(); call.resolve() }
    }

    private func stopAll() {
        listener?.cancel(); listener = nil
        pc?.cancel(); pc = nil
        app?.cancel(); app = nil
    }

    private func accept(_ conn: NWConnection) {
        conn.stateUpdateHandler = { [weak self, weak conn] st in
            guard let self = self, let conn = conn else { return }
            switch st {
            case .failed, .cancelled: self.dropped(conn)
            default: break
            }
        }
        conn.start(queue: queue)
        receive(conn, first: true)
    }

    private func dropped(_ conn: NWConnection) {
        if conn === pc {
            pc = nil
            if let a = app { sendText(#"{"t":"peer","role":"pc","state":"down"}"#, to: a) }
        } else if conn === app {
            app = nil
            if let p = pc { sendText(#"{"t":"peer","role":"app","state":"down"}"#, to: p) }
        }
    }

    private func receive(_ conn: NWConnection, first: Bool) {
        conn.receiveMessage { [weak self] data, context, _, error in
            guard let self = self else { return }
            if error != nil { conn.cancel(); return }
            let meta = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            let opcode = meta?.opcode ?? .binary
            if opcode == .close { conn.cancel(); return }
            if let data = data {
                if first, opcode == .text, let text = String(data: data, encoding: .utf8), text.contains("\"role\"") {
                    // Pierwsza wiadomość mówi, kto się połączył
                    if text.contains("\"pc\"") {
                        self.pc?.cancel(); self.pc = conn
                        if let a = self.app { self.sendText(#"{"t":"peer","role":"pc","state":"up"}"#, to: a) }
                    } else {
                        self.app?.cancel(); self.app = conn
                        if self.pc != nil { self.sendText(#"{"t":"peer","role":"pc","state":"up"}"#, to: conn) }
                    }
                } else if opcode == .text || opcode == .binary {
                    let target = conn === self.pc ? self.app : (conn === self.app ? self.pc : nil)
                    if let t = target { self.forward(data, opcode: opcode, to: t) }
                }
            }
            self.receive(conn, first: false)
        }
    }

    private func forward(_ data: Data, opcode: NWProtocolWebSocket.Opcode, to conn: NWConnection) {
        let meta = NWProtocolWebSocket.Metadata(opcode: opcode)
        let ctx = NWConnection.ContentContext(identifier: "pitayas", metadata: [meta])
        conn.send(content: data, contentContext: ctx, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func sendText(_ text: String, to conn: NWConnection) {
        forward(Data(text.utf8), opcode: .text, to: conn)
    }
}
