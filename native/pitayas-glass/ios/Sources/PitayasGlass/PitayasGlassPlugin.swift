import Foundation
import UIKit
import Capacitor

// ═══════ PITAYAS GLASS ═══════
// Prawdziwy Liquid Glass z iOS 26 dla wybranych przycisków aplikacji.
// Rdzeń (www/core/app.js) wysyła prostokąty przycisków oznaczonych data-glass; tutaj nad WebView stają natywne
// UIButton z konfiguracją .glass(). Dotknięcie wraca do JS zdarzeniem „tap”, a JS klika ukryty przycisk HTML.
// Rdzeń aktualizuje się bez nowej aplikacji, więc to, które przyciski są szklane, decyduje JS.

extension UIColor {
    convenience init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        self.init(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}

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
    private var segs: [String: UISegmentedControl] = [:]

    private static var available: Bool {
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) { return true }
        #endif
        return false
    }

    @objc func isSupported(_ call: CAPPluginCall) {
        // titles: ta wersja umie przyciski z tekstem i kolorem (rdzeń sprawdza to przed użyciem)
        call.resolve(["supported": PitayasGlassPlugin.available, "titles": true, "segments": true, "textStable": true])
    }

    @objc func setButtons(_ call: CAPPluginCall) {
        let list = call.getArray("buttons", JSObject.self) ?? []
        DispatchQueue.main.async {
            call.resolve(["placed": self.apply(list)])
        }
    }

    // Warstwa jako podwidok samego WebView (w Capacitorze widok kontrolera to WebView), współrzędne = współrzędne strony
    private func container() -> GlassPassthroughView? {
        guard let host = bridge?.webView else { return nil }
        if let o = overlay, o.superview === host {
            o.frame = host.bounds
            host.bringSubviewToFront(o)
            return o
        }
        // Nowa warstwa — stare przyciski zostały w poprzedniej
        buttons.values.forEach { $0.removeFromSuperview() }
        segs.values.forEach { $0.removeFromSuperview() }
        segs = [:]
        buttons = [:]
        badges = [:]
        let o = GlassPassthroughView(frame: host.bounds)
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

    @discardableResult
    private func apply(_ list: [JSObject]) -> Int {
        guard PitayasGlassPlugin.available, let box = container() else { return 0 }
        var keep = Set<String>()
        var placed = 0
        for item in list {
            guard let id = item["id"] as? String, !id.isEmpty else { continue }
            keep.insert(id)
            // Przełącznik zakładek: natywny UISegmentedControl — w iOS 26 sam ma Liquid Glass i przesuwane zaznaczenie
            if (item["kind"] as? String) == "segments" {
                let labels = ((item["items"] as? JSArray) ?? []).compactMap { $0 as? String }
                let seg = segs[id] ?? makeSegments(id: id, in: box)
                let current = (0..<seg.numberOfSegments).map { seg.titleForSegment(at: $0) ?? "" }
                if current != labels {
                    seg.removeAllSegments()
                    for (i, t) in labels.enumerated() { seg.insertSegment(withTitle: t, at: i, animated: false) }
                }
                let sel = Int(number(item["selected"]))
                if sel >= 0, sel < seg.numberOfSegments, seg.selectedSegmentIndex != sel { seg.selectedSegmentIndex = sel }
                seg.frame = CGRect(x: number(item["x"]), y: number(item["y"]), width: number(item["w"]), height: number(item["h"]))
                if seg.superview === box, seg.numberOfSegments > 0 { placed += 1 }
                continue
            }
            let symbol = (item["symbol"] as? String) ?? ""
            let title = (item["title"] as? String) ?? ""
            let prominent = (item["style"] as? String) == "prominent"
            let key = prominent ? "p" : "n"
            if let old = buttons[id], old.accessibilityHint != key {   // zmiana stylu = nowy przycisk
                old.removeFromSuperview(); buttons[id] = nil; badges[id] = nil
            }
            let button = buttons[id] ?? makeButton(id: id, in: box, prominent: prominent)
            button.accessibilityHint = key
            button.frame = CGRect(x: number(item["x"]), y: number(item["y"]), width: number(item["w"]), height: number(item["h"]))
            if let hex = item["tint"] as? String, let color = UIColor(hex: hex) { button.tintColor = color }
            setContent(button, symbol: symbol, title: title, light: prominent)
            setBadge(id: id, on: button, text: (item["badge"] as? String) ?? "")
            if button.superview === box, button.configuration?.image != nil || button.configuration?.title != nil { placed += 1 }
        }
        for (id, s) in segs where !keep.contains(id) {
            s.removeFromSuperview()
            segs[id] = nil
        }
        for (id, b) in buttons where !keep.contains(id) {
            b.removeFromSuperview()
            buttons[id] = nil
            badges[id] = nil
        }
        return placed
    }

    private func makeSegments(id: String, in box: UIView) -> UISegmentedControl {
        let seg = UISegmentedControl()
        seg.overrideUserInterfaceStyle = .dark
        seg.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 14, weight: .semibold), .foregroundColor: UIColor.white.withAlphaComponent(0.75)], for: .normal)
        seg.setTitleTextAttributes([.font: UIFont.systemFont(ofSize: 14, weight: .bold), .foregroundColor: UIColor.white], for: .selected)
        seg.accessibilityIdentifier = id
        seg.addAction(UIAction { [weak self, weak seg] _ in
            guard let seg = seg else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            self?.notifyListeners("tap", data: ["id": id, "index": seg.selectedSegmentIndex])
        }, for: .valueChanged)
        box.addSubview(seg)
        segs[id] = seg
        return seg
    }

    private func makeButton(id: String, in box: UIView, prominent: Bool = false) -> UIButton {
        let button = UIButton(type: .system)
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            var cfg = prominent ? UIButton.Configuration.prominentGlass() : UIButton.Configuration.glass()
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

    // Zawartość zmieniamy tylko wtedy, gdy naprawdę się zmieniła — przebudowa konfiguracji przy każdym przewinięciu
    // powodowała miganie i gubienie dotknięć. Ostatnio ustawioną treść pamiętamy w accessibilityValue.
    private func setContent(_ button: UIButton, symbol: String, title: String, light: Bool) {
        let sig = "\(symbol)|\(title)"
        if button.accessibilityValue == sig { return }
        button.accessibilityValue = sig
        guard var cfg = button.configuration else { return }
        let image = symbol.isEmpty ? nil : UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: title.isEmpty ? 17 : 14, weight: .semibold))
        var changed = false
        if cfg.image != image { cfg.image = image; changed = true }
        if cfg.title != (title.isEmpty ? nil : title) {
            if title.isEmpty { cfg.attributedTitle = nil; cfg.title = nil } else {
                cfg.title = title
                var t = AttributedString(title)
                t.font = .systemFont(ofSize: 15, weight: .bold)
                cfg.attributedTitle = t
            }
            cfg.imagePadding = 6
            changed = true
        }
        cfg.baseForegroundColor = .white
        if changed { button.configuration = cfg }
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
