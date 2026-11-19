import WidgetKit
import SwiftUI
import UserNotifications

// ═══════ WIDŻETY „SwC Gry” ═══════
// „Passa” i „Otwarte stoły”. Dane: GET <strona>/api/app/t/inbox z kluczem urządzenia (zapisuje go aplikacja – SwcAppPlugin).
// Ta sama odpowiedź niesie powiadomienia: widżet pokazuje je przy odświeżaniu (krytyczne jako „pilne”), serwer nie wysyła ich drugi raz.
// Tło to zwykłe containerBackground – na przezroczystym/przyciemnionym ekranie głównym (iOS 26) system zamienia je na szkło Liquid Glass,
// a elementy oznaczone widgetAccentable() dostają kolor akcentu.

// ---------- dane ----------
struct SwcWeekDay: Codable { let a: Bool; let t: Bool; let f: Bool }
struct SwcStreak: Codable { let current: Int; let best: Int; let activeToday: Bool; let week: [SwcWeekDay]? }
struct SwcTable: Codable, Identifiable { let game: String; let gameId: String?; let name: String?; let players: Int; let max: Int?; let code: String; let url: String?; var id: String { code } }
struct SwcTables: Codable { let total: Int; let players: Int?; let list: [SwcTable] }
struct SwcWidgetData: Codable { let streak: SwcStreak; let tables: SwcTables; let updatedAt: Double?; let site: String? }
struct SwcNotif: Codable { let id: String; let title: String; let body: String?; let kind: String?; let url: String? }
struct SwcInbox: Codable { let notifications: [SwcNotif]?; let widget: SwcWidgetData? }

extension SwcWidgetData {
    static let sample = SwcWidgetData(
        streak: SwcStreak(current: 5, best: 12, activeToday: false, week: (0..<7).map { SwcWeekDay(a: $0 < 4, t: $0 == 4, f: $0 > 4) }),
        tables: SwcTables(total: 3, players: 7, list: [
            SwcTable(game: "Karty ONU", gameId: "onu", name: "Stół Ali", players: 3, max: 6, code: "ABCDE", url: nil),
            SwcTable(game: "Kalambury", gameId: "kalambury", name: "Rysujemy!", players: 2, max: 8, code: "FGHJK", url: nil),
            SwcTable(game: "Mafia", gameId: "mafia", name: "Wieczór z Mafią", players: 2, max: 16, code: "LMNPQ", url: nil)
        ]), updatedAt: nil, site: nil)
}

enum SwcStore {
    static var group: String { (Bundle.main.object(forInfoDictionaryKey: "ALTAppGroups") as? [String])?.first ?? "group.com.pitayas.swc" }
    static var d: UserDefaults? { UserDefaults(suiteName: group) }
    static var token: String? { let t = d?.string(forKey: "token"); return (t?.count ?? 0) >= 30 ? t : nil }
    static var base: String { d?.string(forKey: "base") ?? "https://swc.pitayas.eu" }
    /// widżet połączony z innym serwerem niż oficjalny (np. testowym) – pokazujemy to na widżecie
    static var isTest: Bool { (URL(string: base)?.host ?? "swc.pitayas.eu") != "swc.pitayas.eu" }
    static func cached() -> SwcWidgetData? {
        guard let s = d?.string(forKey: "widget"), let data = s.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(SwcWidgetData.self, from: data)
    }
    static func save(_ w: SwcWidgetData) {
        if let data = try? JSONEncoder().encode(w), let s = String(data: data, encoding: .utf8) { d?.set(s, forKey: "widget"); d?.set(Date().timeIntervalSince1970, forKey: "widgetAt") }
    }
}

enum SwcNet {
    static func refresh() async -> SwcWidgetData? {
        guard let token = SwcStore.token else { return nil }   // widżet odłączony – nie pokazujemy starych danych
        guard let url = URL(string: SwcStore.base + "/api/app/t/inbox") else { return SwcStore.cached() }
        var req = URLRequest(url: url, timeoutInterval: 12)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 || code == 403 {   // klucz nieważny (urządzenie odłączone, inny serwer) – widżet prosi o ponowne połączenie
                for k in ["token", "widget", "widgetAt"] { SwcStore.d?.removeObject(forKey: k) }
                return nil
            }
            guard code == 200 else { return SwcStore.cached() }
            let inbox = try JSONDecoder().decode(SwcInbox.self, from: data)
            if let list = inbox.notifications, !list.isEmpty { await post(list) }
            if let w = inbox.widget { SwcStore.save(w); return w }
        } catch {}
        return SwcStore.cached()
    }
    // powiadomienia systemowe; kliknięcie obsługuje aplikacja (wtyczka LocalNotifications czyta „cap_extra”)
    static func post(_ list: [SwcNotif]) async {
        let c = UNUserNotificationCenter.current()
        let st = await c.notificationSettings()
        guard st.authorizationStatus == .authorized || st.authorizationStatus == .provisional || st.authorizationStatus == .ephemeral else { return }
        for n in list.prefix(5) {
            let content = UNMutableNotificationContent()
            content.title = n.title
            content.body = n.body ?? ""
            content.sound = .default
            content.threadIdentifier = n.kind == "critical" ? "swc-critical" : "swc"
            content.userInfo = ["cap_extra": ["url": n.url ?? "/", "id": n.id]]
            content.interruptionLevel = n.kind == "critical" ? .timeSensitive : .active
            content.relevanceScore = n.kind == "critical" ? 1 : 0.5
            try? await c.add(UNNotificationRequest(identifier: "swc-" + n.id, content: content, trigger: nil))
        }
    }
}

// ---------- oś czasu ----------
struct SwcEntry: TimelineEntry { let date: Date; let data: SwcWidgetData?; let linked: Bool }

struct SwcProvider: TimelineProvider {
    func placeholder(in context: Context) -> SwcEntry { SwcEntry(date: .now, data: .sample, linked: true) }
    func getSnapshot(in context: Context, completion: @escaping (SwcEntry) -> Void) {
        // dane przykładowe tylko w galerii widżetów; na ekranie głównym prawdziwe albo „połącz widżet”
        if context.isPreview { completion(SwcEntry(date: .now, data: .sample, linked: true)); return }
        completion(SwcEntry(date: .now, data: SwcStore.cached(), linked: SwcStore.token != nil))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SwcEntry>) -> Void) {
        Task {
            let w = await SwcNet.refresh()
            let e = SwcEntry(date: .now, data: w, linked: SwcStore.token != nil)
            completion(Timeline(entries: [e], policy: .after(Date().addingTimeInterval(15 * 60))))
        }
    }
}

// ---------- wygląd (kolory SwC: granat, pomarańcz) ----------
extension Color {
    static let swcNavy = Color(red: 17 / 255, green: 63 / 255, blue: 135 / 255)
    static let swcGold = Color(red: 246 / 255, green: 174 / 255, blue: 69 / 255)
}
func swcDays(_ n: Int) -> String { n == 1 ? "dzień" : "dni" }

/// mały znacznik „Testowy” w rogu, gdy widżet pokazuje dane serwera testowego
struct SwcServerTag: ViewModifier {
    func body(content: Content) -> some View {
        content.overlay(alignment: .bottomTrailing) {
            if SwcStore.isTest {
                Text("🧪 Testowy").font(.system(size: 9, weight: .heavy)).padding(.horizontal, 5).padding(.vertical, 2)
                    .background(Capsule().fill(Color.swcGold)).foregroundStyle(Color.swcNavy)
            }
        }
    }
}
func swcLink(_ path: String) -> URL? {
    var c = URLComponents(); c.scheme = "swc"; c.host = "open"; c.queryItems = [URLQueryItem(name: "path", value: path)]; return c.url
}
func swcIcon(_ id: String?) -> String {
    switch id ?? "" {
    case "onu": return "🃏"; case "kalambury": return "🎨"; case "mafia": return "🕵️"; case "kahoot": return "❓"; case "statki": return "🚢"
    case "poker": return "♠️"; case "kolko": return "⭕"; case "czworki": return "🔴"; case "memory": return "🧩"; case "wisielec": return "🎈"
    case "monopoly": return "🎩"; case "tysiac": return "🂡"; case "gartic": return "📞"; case "skojarzenia": return "💭"
    default: return "🎮"
    }
}

struct SwcNotLinked: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("☁️").font(.system(size: 26))
            Text("Otwórz SwC Gry i zaloguj się, żeby połączyć widżet.").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
            Spacer(minLength: 0)
        }
    }
}

struct PassaView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SwcEntry
    var body: some View {
        Group {
            if !entry.linked && entry.data == nil { SwcNotLinked() } else {
                let s = entry.data?.streak
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 5) { Text("🔥").font(.system(size: 15)); Text("PASSA").font(.system(size: 12, weight: .heavy)).foregroundStyle(.white.opacity(0.8)) }
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            Text("\(s?.current ?? 0)").font(.system(size: family == .systemSmall ? 46 : 52, weight: .black, design: .rounded)).widgetAccentable()
                            Text(swcDays(s?.current ?? 0)).font(.system(size: 15, weight: .bold))
                        }
                        if let w = s?.week, !w.isEmpty {
                            HStack(spacing: 4) {
                                ForEach(0..<w.count, id: \.self) { i in
                                    Capsule().fill(w[i].a ? Color.swcGold : Color.white.opacity(0.25)).frame(height: 6)
                                        .overlay(Capsule().stroke(Color.white, lineWidth: w[i].t ? 1.5 : 0))
                                        .widgetAccentable(w[i].a)
                                }
                            }
                        }
                        Spacer(minLength: 0)
                        Text((s?.activeToday ?? false) ? "✓ Dziś zaliczone" : "Zagraj dziś, żeby nie przerwać passy")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
                    }
                    if family != .systemSmall {
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("REKORD").font(.system(size: 11, weight: .heavy)).foregroundStyle(.white.opacity(0.7))
                            Text("\(s?.best ?? 0)").font(.system(size: 28, weight: .black, design: .rounded))
                            Text(swcDays(s?.best ?? 0)).font(.system(size: 12, weight: .bold)).foregroundStyle(.white.opacity(0.8))
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
        }
        .modifier(SwcServerTag())
        .foregroundStyle(.white)
        .containerBackground(for: .widget) { Color.swcNavy }
        .widgetURL(swcLink("/"))
    }
}

struct StolyView: View {
    @Environment(\.widgetFamily) private var family
    let entry: SwcEntry
    var body: some View {
        Group {
            if !entry.linked && entry.data == nil { SwcNotLinked() } else {
                let t = entry.data?.tables
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 5) {
                        Text("🃏").font(.system(size: 15)); Text("OTWARTE STOŁY").font(.system(size: 12, weight: .heavy)).foregroundStyle(.white.opacity(0.8))
                        Spacer(minLength: 0)
                        if family != .systemSmall { Text("\(t?.total ?? 0)").font(.system(size: 20, weight: .black, design: .rounded)).widgetAccentable() }
                    }
                    if family == .systemSmall {
                        Text("\(t?.total ?? 0)").font(.system(size: 46, weight: .black, design: .rounded)).widgetAccentable()
                        Text((t?.total ?? 0) == 0 ? "Nikt teraz nie czeka" : "\(t?.players ?? 0) os. czeka przy stołach").font(.system(size: 12, weight: .semibold)).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
                        Spacer(minLength: 0)
                        if let first = t?.list.first { Text("\(swcIcon(first.gameId)) \(first.game)").font(.system(size: 12, weight: .bold)).lineLimit(1) }
                    } else if let list = t?.list, !list.isEmpty {
                        ForEach(list.prefix(3)) { x in
                            Link(destination: swcLink(x.url.flatMap { URL(string: $0)?.path }.map { "\($0)?kod=\(x.code)" } ?? "/gry") ?? URL(string: "swc://open")!) {
                                HStack(spacing: 8) {
                                    Text(swcIcon(x.gameId)).font(.system(size: 15))
                                    VStack(alignment: .leading, spacing: 0) {
                                        Text(x.game).font(.system(size: 13, weight: .bold)).lineLimit(1)
                                        if let n = x.name, !n.isEmpty { Text(n).font(.system(size: 11)).foregroundStyle(.white.opacity(0.75)).lineLimit(1) }
                                    }
                                    Spacer(minLength: 0)
                                    Text(x.max.map { "\(x.players)/\($0)" } ?? "\(x.players)").font(.system(size: 13, weight: .heavy, design: .rounded))
                                        .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(Color.swcGold.opacity(0.9))).foregroundStyle(Color.swcNavy).widgetAccentable()
                                }
                            }
                        }
                        Spacer(minLength: 0)
                    } else {
                        Spacer(minLength: 0)
                        Text("Nikt teraz nie czeka – załóż stół i zaproś znajomych!").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white.opacity(0.9))
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .modifier(SwcServerTag())
        .foregroundStyle(.white)
        .containerBackground(for: .widget) { Color.swcNavy }
        .widgetURL(swcLink("/gry"))
    }
}

struct PassaWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SwcPassa", provider: SwcProvider()) { PassaView(entry: $0) }
            .configurationDisplayName("Passa")
            .description("Twoja seria dni z rzędu w Szkole w Chmurze.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct StolyWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SwcStoly", provider: SwcProvider()) { StolyView(entry: $0) }
            .configurationDisplayName("Otwarte stoły")
            .description("Stoły, przy których ktoś czeka – dotknij, żeby dołączyć.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct SwcWidgetsBundle: WidgetBundle {
    var body: some Widget {
        PassaWidget()
        StolyWidget()
    }
}
