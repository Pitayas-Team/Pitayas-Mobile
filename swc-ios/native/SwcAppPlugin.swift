import Foundation
import Capacitor
import WidgetKit

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

@objc(SwcAppPlugin)
public class SwcAppPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SwcAppPlugin"
    public let jsName = "SwcApp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

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
        call.resolve(["group": SwcShared.groupId, "configured": (d?.string(forKey: "token") ?? "").count >= 30])
    }
}
