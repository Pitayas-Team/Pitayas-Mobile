import Foundation
import Capacitor
import WidgetKit
import WebKit

// ═══════ SWC APP (tylko aplikacja „SwC Gry”) ═══════
// Strona (swc.pitayas.eu/app-bridge.js) po zalogowaniu rejestruje urządzenie i przekazuje tu klucz urządzenia.
// Klucz trafia do wspólnych danych aplikacji i widżetów (App Group), więc widżety „Passa” i „Otwarte stoły”
// same pobierają dane z serwera. AltStore/SideStore zmieniają identyfikator grupy – prawdziwy jest w Info.plist (ALTAppGroups).

enum SwcShared {
    static var groupId: String {
        if let g = (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String])?.first { return g }
        return "group.com.pitayas.swc"
    }
    static var defaults: UserDefaults? { UserDefaults(suiteName: groupId) }
}

/// Capacitor 8 pokazuje stronę błędu (index.html) przy KAŻDYM nieudanym wczytaniu – także gdy wczytanie zostało tylko
/// przerwane (przekierowanie na serwer testowy, szybkie stuknięcie w link, location.replace w trakcie ładowania).
/// Stąd „Brak połączenia” zaraz po starcie mimo działającej sieci. Ta nakładka przepuszcza wszystko do Capacitora,
/// poza błędami „przerwano” (NSURLErrorCancelled, WebKit 102 „Frame load interrupted”).
final class SwcNavGuard: NSObject, WKNavigationDelegate {
    weak var inner: WKNavigationDelegate?
    init(_ inner: WKNavigationDelegate) { self.inner = inner }
    static func interrupted(_ e: Error) -> Bool {
        let n = e as NSError
        return (n.domain == NSURLErrorDomain && n.code == NSURLErrorCancelled) || (n.domain == "WebKitErrorDomain" && (n.code == 102 || n.code == 204))
    }
    override func responds(to aSelector: Selector!) -> Bool { super.responds(to: aSelector) || (inner?.responds(to: aSelector) ?? false) }
    override func forwardingTarget(for aSelector: Selector!) -> Any? { (inner?.responds(to: aSelector) ?? false) ? inner : nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if SwcNavGuard.interrupted(error) { return }
        inner?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if SwcNavGuard.interrupted(error) { return }
        inner?.webView?(webView, didFail: navigation, withError: error)
    }
}

@objc(SwcAppPlugin)
public class SwcAppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SwcAppPlugin"
    public let jsName = "SwcApp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]
    private var navGuard: SwcNavGuard?

    override public func load() {
        DispatchQueue.main.async { [weak self] in self?.installGuard() }
    }
    private func installGuard() {
        guard let wv = bridge?.webView, let cur = wv.navigationDelegate, !(cur is SwcNavGuard) else { return }
        let g = SwcNavGuard(cur); navGuard = g; wv.navigationDelegate = g
    }

    /// { base } – ostatni serwer, na którym była aplikacja (oficjalny / testowy); strona „Łączę…” wraca właśnie tam
    @objc func setServer(_ call: CAPPluginCall) {
        guard let base = call.getString("base"), base.hasPrefix("https://"), base.count < 200 else { call.reject("Zły adres"); return }
        SwcShared.defaults?.set(base, forKey: "server")
        call.resolve()
    }

    /// Odłącza widżety (np. inny serwer albo brak dostępu do aplikacji) – pokazują „Otwórz SwC Gry i zaloguj się”
    @objc func clear(_ call: CAPPluginCall) {
        let d = SwcShared.defaults
        for k in ["token", "deviceId", "widget", "widgetAt"] { d?.removeObject(forKey: k) }
        if let base = call.getString("base"), base.hasPrefix("https://") { d?.set(base, forKey: "base") }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /// { token, base, deviceId } – zapis dla widżetów i odświeżenie ich od razu
    @objc func configure(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), token.count >= 30, let base = call.getString("base"), base.hasPrefix("https://") else {
            call.reject("Brak klucza urządzenia albo adresu strony"); return
        }
        let d = SwcShared.defaults
        d?.set(token, forKey: "token")
        d?.set(base, forKey: "base")
        d?.set(call.getString("deviceId") ?? "", forKey: "deviceId")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["group": SwcShared.groupId, "ok": d != nil])
    }

    /// { data: "<json z /api/app/inbox → widget>" } – świeże dane, gdy aplikacja jest otwarta
    @objc func updateWidget(_ call: CAPPluginCall) {
        if let s = call.getString("data"), s.count < 60000 {
            SwcShared.defaults?.set(s, forKey: "widget")
            SwcShared.defaults?.set(Date().timeIntervalSince1970, forKey: "widgetAt")
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }

    @objc func status(_ call: CAPPluginCall) {
        let d = SwcShared.defaults
        call.resolve(["group": SwcShared.groupId, "configured": (d?.string(forKey: "token") ?? "").count >= 30,
                      "base": d?.string(forKey: "base") ?? "", "server": d?.string(forKey: "server") ?? ""])
    }
}
