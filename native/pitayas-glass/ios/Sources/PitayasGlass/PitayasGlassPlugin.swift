import Foundation
import UIKit
import Capacitor

// ═══════ PITAYAS GLASS ═══════
// Prawdziwy Liquid Glass z iOS 26 dla wybranych przycisków aplikacji.
// Rdzeń (www/core/app.js) wysyła prostokąty przycisków oznaczonych data-glass; tutaj nad WebView stają natywne
// UIButton z konfiguracją .glass(). Dotknięcie wraca do JS zdarzeniem „tap”, a JS klika ukryty przycisk HTML.
// Rdzeń aktualizuje się bez nowej aplikacji, więc to, które przyciski są szklane, decyduje JS.

/// Przezroczysta warstwa: dotyk poza przyciskami idzie dalej do WebView
final class GlassPassthroughView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}

@objc(PitayasGlassPlugin)
public class PitayasGlassPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PitayasGlassPlugin"
    public let jsName = "PitayasGlass"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setButtons", returnType: CAPPluginReturnPromise)
    ]

    private var overlay: GlassPassthroughView?
    private var buttons: [String: UIButton] = [:]
    private var badges: [String: UILabel] = [:]

    private static var available: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": PitayasGlassPlugin.available])
    }

    @objc func setButtons(_ call: CAPPluginCall) {
        let list = call.getArray("buttons", JSObject.self) ?? []
        DispatchQueue.main.async {
            self.apply(list)
            call.resolve()
        }
    }

    private func container() -> GlassPassthroughView? {
        guard let webView = bridge?.webView, let host = webView.superview else { return nil }
        if let o = overlay, o.superview === host {
            o.frame = webView.frame
            host.bringSubviewToFront(o)
            return o
        }
        let o = GlassPassthroughView(frame: webView.frame)
        o.backgroundColor = .clear
        o.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.addSubview(o)
        overlay = o
        return o
    }

    private func number(_ v: Any?) -> CGFloat {
        if let d = v as? Double { return CGFloat(d) }
        if let i = v as? Int { return CGFloat(i) }
        if let n = v as? NSNumber { return CGFloat(truncating: n) }
        return 0
    }

    private func apply(_ list: [JSObject]) {
        guard PitayasGlassPlugin.available, let box = container() else { return }
        var keep = Set<String>()
        for item in list {
            guard let id = item["id"] as? String, !id.isEmpty else { continue }
            keep.insert(id)
            let symbol = (item["symbol"] as? String) ?? "circle"
            let button = buttons[id] ?? makeButton(id: id, in: box)
            button.frame = CGRect(x: number(item["x"]), y: number(item["y"]), width: number(item["w"]), height: number(item["h"]))
            setSymbol(button, symbol)
            setBadge(id: id, on: button, text: (item["badge"] as? String) ?? "")
        }
        for (id, b) in buttons where !keep.contains(id) {
            b.removeFromSuperview()
            buttons[id] = nil
            badges[id] = nil
        }
    }

    private func makeButton(id: String, in box: UIView) -> UIButton {
        let button = UIButton(type: .system)
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            var cfg = UIButton.Configuration.glass()
            cfg.cornerStyle = .capsule
            cfg.baseForegroundColor = .white
            button.configuration = cfg
        }
        #endif
        button.accessibilityIdentifier = id
        button.addAction(UIAction { [weak self] _ in
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            self?.notifyListeners("tap", data: ["id": id])
        }, for: .touchUpInside)
        box.addSubview(button)
        buttons[id] = button
        return button
    }

    private func setSymbol(_ button: UIButton, _ symbol: String) {
        guard var cfg = button.configuration else { return }
        let image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .semibold))
        if cfg.image != image {
            cfg.image = image
            button.configuration = cfg
        }
    }

    private func setBadge(id: String, on button: UIButton, text: String) {
        if text.isEmpty || text == "0" {
            badges[id]?.removeFromSuperview()
            badges[id] = nil
            return
        }
        let label = badges[id] ?? {
            let l = UILabel()
            l.font = .systemFont(ofSize: 11, weight: .heavy)
            l.textColor = .white
            l.textAlignment = .center
            l.backgroundColor = UIColor(red: 1, green: 0.42, blue: 0.5, alpha: 1)
            l.layer.cornerRadius = 9
            l.layer.masksToBounds = true
            l.isUserInteractionEnabled = false
            button.addSubview(l)
            badges[id] = l
            return l
        }()
        label.text = text
        let w = max(18, label.intrinsicContentSize.width + 10)
        label.frame = CGRect(x: button.bounds.width - w + 4, y: -4, width: w, height: 18)
        button.clipsToBounds = false
    }
}
