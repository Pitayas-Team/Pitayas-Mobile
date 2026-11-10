// Serwer w sieci domowej: GET /info (kto tu jest) i WebSocket /ws (parowanie, wysyłanie filmu, pilot).
// Opis komunikatów: PROTOCOL.md.
use crate::player::{browser_status, PlayerHandle};
use crate::services::check_url;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use pitayas_core::util::now_iso;
use pitayas_core::{Logger, Settings};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, watch, Notify};

pub const PROTOCOL: u64 = 1;
pub const DEFAULT_PORT: u16 = 8197;
const MAX_MESSAGE: usize = 16 * 1024;
const MAX_DEVICES: usize = 20;
const MAX_FAILS: u32 = 5;
const LOCK_TIME: Duration = Duration::from_secs(300);
const HELLO_TIME: Duration = Duration::from_secs(10);
/// zamknięcie: nieudane parowanie / telefon zapomniany na telewizorze
const CLOSE_AUTH: u16 = 4001;
const CLOSE_FORGOTTEN: u16 = 4003;
const ACTIONS: &[&str] = &[
    "playpause", "play", "pause", "seek", "seekto", "volume", "mute", "fullscreen", "key", "text", "move", "click", "scroll", "reload", "stop",
];

enum Out {
    Text(String),
    Close(u16, &'static str),
}

struct Client {
    device: String,
    tx: mpsc::UnboundedSender<Out>,
}

struct Inner {
    settings: Settings,
    log: Logger,
    player: PlayerHandle,
    name: String,
    version: String,
    clients: Mutex<HashMap<u64, Client>>,
    next_client: AtomicU64,
    /// błędne PIN-y z adresu: (ile, kiedy ostatni)
    fails: Mutex<HashMap<IpAddr, (u32, Instant)>>,
    /// licznik zmian (PIN, telefony, połączenia) — okno telewizora odświeża się po zmianie
    changed: watch::Sender<u64>,
    port: Mutex<Option<u16>>,
    error: Mutex<String>,
    stop: Mutex<Option<Arc<Notify>>>,
}

#[derive(Clone)]
pub struct Server(Arc<Inner>);

fn random(len: usize) -> Vec<u8> {
    let mut buf = vec![0u8; len];
    getrandom::fill(&mut buf).expect("brak źródła losowości");
    buf
}

fn hash(text: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(text.as_bytes()))
}

/// Porównanie w stałym czasie (po skrótach — długość też nie wycieka)
fn same(a: &str, b: &str) -> bool {
    let (x, y) = (Sha256::digest(a.as_bytes()), Sha256::digest(b.as_bytes()));
    x.iter().zip(y.iter()).fold(0u8, |acc, (p, q)| acc | (p ^ q)) == 0
}

fn clean_name(v: &Value) -> String {
    let name: String = v.as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(40).collect();
    if name.trim().is_empty() { "Telefon".into() } else { name.trim().to_string() }
}

pub fn host_name() -> String {
    let name = std::fs::read_to_string("/proc/sys/kernel/hostname").unwrap_or_default();
    if name.trim().is_empty() { "Telewizor".into() } else { name.trim().to_string() }
}

/// Adres komputera w sieci domowej (gniazdo UDP niczego nie wysyła — pytamy tylko system o trasę)
pub fn addresses() -> Vec<String> {
    let ip = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|s| s.connect("192.0.2.1:9").and_then(|_| s.local_addr())).map(|a| a.ip());
    match ip {
        Ok(ip) if !ip.is_loopback() && !ip.is_unspecified() => vec![ip.to_string()],
        _ => vec![],
    }
}

impl Server {
    pub fn new(settings: Settings, log: Logger, player: PlayerHandle, version: &str) -> Server {
        let (changed, _) = watch::channel(0);
        let s = Server(Arc::new(Inner {
            settings, log, player, name: host_name(), version: version.to_string(),
            clients: Mutex::default(), next_client: AtomicU64::new(1), fails: Mutex::default(), changed,
            port: Mutex::default(), error: Mutex::default(), stop: Mutex::default(),
        }));
        s.pin();
        // Zmiany stanu odtwarzacza idą do wszystkich sparowanych telefonów
        let (me, mut state) = (s.clone(), s.0.player.subscribe());
        tokio::spawn(async move {
            while state.changed().await.is_ok() {
                let text = json!({ "t": "state", "state": *state.borrow_and_update() }).to_string();
                for c in me.0.clients.lock().unwrap().values() {
                    let _ = c.tx.send(Out::Text(text.clone()));
                }
            }
        });
        s
    }

    fn touch(&self) {
        self.0.changed.send_modify(|n| *n += 1);
    }

    /// Powiadomienia o zmianach widocznych na ekranie telewizora
    pub fn changes(&self) -> watch::Receiver<u64> {
        self.0.changed.subscribe()
    }

    pub fn pin(&self) -> String {
        let pin = self.0.settings.get_str("pin");
        if pin.len() == 6 && pin.chars().all(|c| c.is_ascii_digit()) {
            return pin;
        }
        self.new_pin()
    }

    pub fn new_pin(&self) -> String {
        let r = random(4);
        let pin = format!("{:06}", u32::from_le_bytes([r[0], r[1], r[2], r[3]]) % 1_000_000);
        self.0.settings.set("pin", json!(pin));
        self.touch();
        pin
    }

    fn device_list(&self) -> Vec<Value> {
        self.0.settings.get("devices").as_array().cloned().unwrap_or_default()
    }

    /// Sparowane telefony dla okna telewizora (bez skrótów tokenów)
    pub fn devices(&self) -> Vec<Value> {
        let clients = self.0.clients.lock().unwrap();
        self.device_list()
            .iter()
            .map(|d| json!({ "id": d["id"], "name": d["name"], "seen": d["seen"], "online": clients.values().any(|c| d["id"] == c.device.as_str()) }))
            .collect()
    }

    /// Zapomina jeden telefon albo wszystkie; ich połączenia są zamykane, a tokeny przestają działać
    pub fn forget(&self, id: Option<&str>) {
        let keep: Vec<Value> = self.device_list().into_iter().filter(|d| id.is_some_and(|id| d["id"] != id)).collect();
        self.0.settings.set("devices", json!(keep));
        for c in self.0.clients.lock().unwrap().values() {
            if id.is_none_or(|id| c.device == id) {
                let _ = c.tx.send(Out::Close(CLOSE_FORGOTTEN, "Telefon został zapomniany na telewizorze"));
            }
        }
        self.touch();
    }

    pub fn port(&self) -> Option<u16> {
        *self.0.port.lock().unwrap()
    }

    pub fn error(&self) -> String {
        self.0.error.lock().unwrap().clone()
    }

    /// Uruchamia serwer (albo przenosi go na inny port). Port 0 = dowolny wolny (testy).
    pub async fn start(&self, port: u16) -> Result<u16, String> {
        if let Some(stop) = self.0.stop.lock().unwrap().take() {
            stop.notify_one();
        }
        *self.0.port.lock().unwrap() = None;
        let listener = match tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
            Ok(l) => l,
            Err(e) => {
                let text = if e.kind() == std::io::ErrorKind::AddrInUse { format!("Port {port} jest zajęty przez inny program") } else { format!("Serwer nie wystartował: {e}") };
                self.0.log.error(&text);
                *self.0.error.lock().unwrap() = text.clone();
                self.touch();
                return Err(text);
            }
        };
        let port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
        let app = Router::new().route("/info", get(info)).route("/ws", get(upgrade)).with_state(self.clone());
        let stop = Arc::new(Notify::new());
        *self.0.stop.lock().unwrap() = Some(stop.clone());
        *self.0.port.lock().unwrap() = Some(port);
        self.0.error.lock().unwrap().clear();
        self.0.log.info(format!("Serwer Watch: port {port}"));
        // Przy zmianie portu stare połączenia też się kończą — telefony połączą się na nowym
        for c in self.0.clients.lock().unwrap().values() {
            let _ = c.tx.send(Out::Close(1001, "Serwer zmienia port"));
        }
        tokio::spawn(async move {
            let serve = axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>());
            let _ = serve.with_graceful_shutdown(async move { stop.notified().await }).await;
        });
        self.touch();
        Ok(port)
    }

    /// Ok(()) albo ile sekund blokady zostało
    fn locked(&self, ip: IpAddr) -> Option<u64> {
        let mut fails = self.0.fails.lock().unwrap();
        fails.retain(|_, (_, at)| at.elapsed() < LOCK_TIME);
        fails.get(&ip).filter(|(n, _)| *n >= MAX_FAILS).map(|(_, at)| LOCK_TIME.saturating_sub(at.elapsed()).as_secs().max(1))
    }

    /// Sprawdza „hello”. Ok((id telefonu, nowy token)) albo Err((kod, tekst)).
    fn pair(&self, hello: &Value, ip: IpAddr) -> Result<(String, Option<String>), (&'static str, String)> {
        let locked = |secs: u64| ("locked", format!("Za dużo błędnych kodów. Spróbuj za {} min.", secs.div_ceil(60)));
        if let Some(secs) = self.locked(ip) {
            return Err(locked(secs));
        }
        let mut devices = self.device_list();
        if let Some(token) = hello["token"].as_str().filter(|t| !t.is_empty()) {
            let h = hash(token);
            let Some(d) = devices.iter_mut().find(|d| same(d["hash"].as_str().unwrap_or(""), &h)) else {
                return Err(("auth", "Ten telefon nie jest już sparowany — podaj kod PIN z telewizora".into()));
            };
            d["seen"] = json!(now_iso());
            let id = d["id"].as_str().unwrap_or("").to_string();
            self.0.settings.set("devices", json!(devices));
            return Ok((id, None));
        }
        let Some(pin) = hello["pin"].as_str().filter(|p| !p.is_empty()) else {
            return Err(("auth", "Podaj kod PIN z ekranu telewizora".into()));
        };
        if !same(pin.trim(), &self.pin()) {
            let mut fails = self.0.fails.lock().unwrap();
            let f = fails.entry(ip).or_insert((0, Instant::now()));
            *f = (f.0 + 1, Instant::now());
            if f.0 >= MAX_FAILS {
                self.0.log.warn(format!("Parowanie zablokowane dla {ip} (błędne kody PIN)"));
                return Err(locked(LOCK_TIME.as_secs()));
            }
            return Err(("pin", "Błędny kod PIN".into()));
        }
        self.0.fails.lock().unwrap().remove(&ip);
        // Token zna tylko telefon — u nas zostaje sam skrót
        let token = URL_SAFE_NO_PAD.encode(random(32));
        let id = URL_SAFE_NO_PAD.encode(random(8));
        let name = clean_name(&hello["name"]);
        self.0.log.info(format!("Sparowano telefon: {name}"));
        devices.push(json!({ "id": id, "name": name, "hash": hash(&token), "added": now_iso(), "seen": now_iso() }));
        if devices.len() > MAX_DEVICES {
            let extra = devices.len() - MAX_DEVICES;
            for d in &devices[..extra] {
                self.close_device(d["id"].as_str().unwrap_or(""));
            }
            devices.drain(..extra);
        }
        self.0.settings.set("devices", json!(devices));
        Ok((id, Some(token)))
    }

    fn close_device(&self, id: &str) {
        for c in self.0.clients.lock().unwrap().values().filter(|c| c.device == id) {
            let _ = c.tx.send(Out::Close(CLOSE_FORGOTTEN, "Telefon został zapomniany na telewizorze"));
        }
    }

    /// Komunikat od sparowanego telefonu → odpowiedź
    async fn handle(&self, msg: &Value) -> Option<Value> {
        let id = msg["id"].clone();
        let ack = |r: Result<(), String>| match r {
            Ok(()) => json!({ "t": "ack", "id": id, "ok": true }),
            Err(e) => json!({ "t": "ack", "id": id, "ok": false, "error": e }),
        };
        match msg["t"].as_str().unwrap_or("") {
            "ping" => Some(json!({ "t": "pong" })),
            "state" => Some(json!({ "t": "state", "state": self.0.player.state() })),
            "open" => {
                let any_host = self.0.settings.get("anyHost") == Value::Bool(true);
                let title: String = msg["title"].as_str().unwrap_or("").chars().filter(|c| !c.is_control()).take(200).collect();
                let r = match check_url(msg["url"].as_str().unwrap_or(""), any_host) {
                    Ok(c) => self.0.player.open(c.url, title).await,
                    Err(e) => Err(e),
                };
                Some(ack(r))
            }
            "cmd" => {
                let action = msg["action"].as_str().unwrap_or("");
                if !ACTIONS.contains(&action) {
                    return Some(ack(Err("Nieznane polecenie".into())));
                }
                Some(ack(self.0.player.command(action, msg["value"].clone()).await))
            }
            _ => None,
        }
    }
}

async fn info(State(s): State<Server>) -> impl IntoResponse {
    let body = json!({
        "app": "pitayas-watch", "protocol": PROTOCOL, "name": s.0.name, "version": s.0.version,
        "drm": browser_status(&s.0.settings), "open": s.0.player.is_open(),
    });
    ([("Access-Control-Allow-Origin", "*"), ("Cache-Control", "no-store")], Json(body))
}

async fn upgrade(ws: WebSocketUpgrade, ConnectInfo(addr): ConnectInfo<SocketAddr>, State(s): State<Server>) -> impl IntoResponse {
    ws.max_message_size(MAX_MESSAGE).on_upgrade(move |socket| client(socket, addr.ip(), s))
}

async fn send(socket: &mut WebSocket, v: Value) -> bool {
    socket.send(Message::Text(v.to_string().into())).await.is_ok()
}

async fn close(socket: &mut WebSocket, code: u16, reason: &'static str) {
    let _ = socket.send(Message::Close(Some(CloseFrame { code, reason: reason.into() }))).await;
}

async fn next_json(socket: &mut WebSocket) -> Option<Value> {
    loop {
        match socket.recv().await?.ok()? {
            Message::Text(t) => return Some(serde_json::from_str(t.as_str()).unwrap_or(Value::Null)),
            Message::Close(_) => return None,
            _ => {}
        }
    }
}

async fn client(mut socket: WebSocket, ip: IpAddr, s: Server) {
    // Pierwszy komunikat musi być „hello” z PIN-em albo tokenem
    let Ok(Some(hello)) = tokio::time::timeout(HELLO_TIME, next_json(&mut socket)).await else {
        return close(&mut socket, CLOSE_AUTH, "Brak parowania").await;
    };
    let paired = if hello["t"] == "hello" { s.pair(&hello, ip) } else { Err(("auth", "Najpierw sparuj telefon z telewizorem".into())) };
    let (device, token) = match paired {
        Ok(p) => p,
        Err((code, text)) => {
            send(&mut socket, json!({ "t": "error", "code": code, "text": text })).await;
            return close(&mut socket, CLOSE_AUTH, "Brak parowania").await;
        }
    };
    let mut welcome = json!({ "t": "welcome", "protocol": PROTOCOL, "tv": s.0.name, "state": s.0.player.state() });
    if let Some(t) = token {
        welcome["token"] = json!(t);
    }
    let (tx, mut rx) = mpsc::unbounded_channel();
    let id = s.0.next_client.fetch_add(1, Ordering::Relaxed);
    s.0.clients.lock().unwrap().insert(id, Client { device, tx });
    s.touch();
    if send(&mut socket, welcome).await {
        loop {
            tokio::select! {
                msg = next_json(&mut socket) => {
                    let Some(msg) = msg else { break };
                    if let Some(reply) = s.handle(&msg).await {
                        if !send(&mut socket, reply).await { break; }
                    }
                }
                out = rx.recv() => match out {
                    Some(Out::Text(t)) => if socket.send(Message::Text(t.into())).await.is_err() { break },
                    Some(Out::Close(code, reason)) => { close(&mut socket, code, reason).await; break; }
                    None => break,
                },
            }
        }
    }
    s.0.clients.lock().unwrap().remove(&id);
    s.touch();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::player::Req;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message as M;

    type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

    /// Serwer z udawanym odtwarzaczem (bez przeglądarki)
    async fn tv(name: &str) -> (Server, u16) {
        let dir = std::env::temp_dir().join(format!("pitayas-watch-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let settings = Settings::load(dir.join("settings.json"), json!({ "port": 0, "pin": "", "devices": [], "anyHost": false }));
        let (player, mut rx, state) = PlayerHandle::channel();
        tokio::spawn(async move {
            let mut s = json!({ "open": false });
            while let Some(req) = rx.recv().await {
                match req {
                    Req::Open { url, title, reply } => {
                        s = json!({ "open": true, "url": url, "title": title, "video": { "paused": false, "time": 0 } });
                        let _ = reply.send(Ok(()));
                    }
                    Req::Cmd { action, value, reply } => {
                        match action.as_str() {
                            "playpause" => s["video"]["paused"] = json!(!s["video"]["paused"].as_bool().unwrap_or(false)),
                            "seek" => s["video"]["time"] = json!(s["video"]["time"].as_f64().unwrap_or(0.0) + value.as_f64().unwrap_or(0.0)),
                            "stop" => s = json!({ "open": false }),
                            _ => {}
                        }
                        let _ = reply.send(Ok(()));
                    }
                }
                let _ = state.send(s.clone());
            }
        });
        let server = Server::new(settings, Logger::new(&dir, "test"), player, "0.0.0-test");
        let port = server.start(0).await.unwrap();
        (server, port)
    }

    async fn connect(port: u16) -> Ws {
        tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/ws")).await.unwrap().0
    }
    async fn say(ws: &mut Ws, v: Value) {
        ws.send(M::Text(v.to_string().into())).await.unwrap();
    }
    /// Następny komunikat; zamknięcie połączenia → { "closed": kod }
    async fn hear(ws: &mut Ws) -> Value {
        loop {
            match tokio::time::timeout(Duration::from_secs(5), ws.next()).await.expect("brak odpowiedzi") {
                Some(Ok(M::Text(t))) => return serde_json::from_str(t.as_str()).unwrap(),
                Some(Ok(M::Close(f))) => return json!({ "closed": f.map(|f| u16::from(f.code)).unwrap_or(0) }),
                Some(Ok(_)) => {}
                _ => return json!({ "closed": 0 }),
            }
        }
    }
    /// Następny komunikat danego rodzaju (stany rozsyłane w tle pomijamy)
    async fn hear_t(ws: &mut Ws, t: &str) -> Value {
        loop {
            let v = hear(ws).await;
            if v["t"] == t || v.get("closed").is_some() {
                return v;
            }
        }
    }

    #[tokio::test]
    async fn parowanie_i_pilot() {
        let (server, port) = tv("pilot").await;
        let pin = server.pin();

        // /info niczego nie zdradza
        let mut tcp = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        tcp.write_all(b"GET /info HTTP/1.1\r\nHost: tv\r\nConnection: close\r\n\r\n").await.unwrap();
        let mut body = String::new();
        tcp.read_to_string(&mut body).await.unwrap();
        assert!(body.contains("pitayas-watch") && body.to_lowercase().contains("access-control-allow-origin: *"));
        assert!(!body.contains(&pin), "/info nie może pokazywać PIN-u");

        // Polecenie bez parowania
        let mut ws = connect(port).await;
        say(&mut ws, json!({ "t": "cmd", "id": 1, "action": "playpause" })).await;
        assert_eq!(hear(&mut ws).await["code"], "auth");
        assert_eq!(hear(&mut ws).await["closed"], CLOSE_AUTH);

        // Parowanie PIN-em → token; w ustawieniach tylko skrót
        let mut ws = connect(port).await;
        say(&mut ws, json!({ "t": "hello", "name": "Telefon testowy", "pin": pin })).await;
        let welcome = hear(&mut ws).await;
        assert_eq!(welcome["t"], "welcome");
        assert_eq!(welcome["protocol"], PROTOCOL);
        let token = welcome["token"].as_str().unwrap().to_string();
        let saved = server.0.settings.get("devices").to_string();
        assert!(!saved.contains(&token) && saved.contains("Telefon testowy"));
        assert_eq!(server.devices()[0]["online"], true);
        assert!(server.devices()[0].get("hash").is_none());

        // Adresy: tylko https i znane serwisy
        say(&mut ws, json!({ "t": "open", "id": 2, "url": "https://example.com/film" })).await;
        let ack = hear_t(&mut ws, "ack").await;
        assert_eq!((ack["id"].as_i64(), ack["ok"].as_bool()), (Some(2), Some(false)));
        say(&mut ws, json!({ "t": "open", "id": 3, "url": "http://www.netflix.com/watch/1" })).await;
        assert_eq!(hear_t(&mut ws, "ack").await["ok"], false);
        say(&mut ws, json!({ "t": "open", "id": 4, "url": "https://www.netflix.com/watch/1", "title": "Film" })).await;
        let mut got = (false, false);
        while got != (true, true) {
            let v = hear(&mut ws).await;
            match v["t"].as_str() {
                Some("ack") => { assert_eq!(v["ok"], true); got.0 = true; }
                Some("state") if v["state"]["open"] == true => { assert_eq!(v["state"]["title"], "Film"); got.1 = true; }
                _ => {}
            }
        }

        // Pilot
        say(&mut ws, json!({ "t": "cmd", "id": 5, "action": "playpause" })).await;
        assert_eq!(hear_t(&mut ws, "ack").await["ok"], true);
        say(&mut ws, json!({ "t": "cmd", "id": 6, "action": "seek", "value": 30 })).await;
        assert_eq!(hear_t(&mut ws, "ack").await["id"], 6);
        say(&mut ws, json!({ "t": "state" })).await;
        loop {
            let st = hear_t(&mut ws, "state").await;
            if st["state"]["video"]["time"] == 30.0 { assert_eq!(st["state"]["video"]["paused"], true); break; }
        }
        say(&mut ws, json!({ "t": "cmd", "id": 7, "action": "format-disk" })).await;
        let ack = hear_t(&mut ws, "ack").await;
        assert_eq!((ack["id"].as_i64(), ack["ok"].as_bool()), (Some(7), Some(false)));
        say(&mut ws, json!({ "t": "ping" })).await;
        assert_eq!(hear_t(&mut ws, "pong").await["t"], "pong");

        // Ponowne połączenie tokenem — bez nowego tokenu
        let mut again = connect(port).await;
        say(&mut again, json!({ "t": "hello", "token": token })).await;
        let welcome = hear(&mut again).await;
        assert_eq!(welcome["t"], "welcome");
        assert!(welcome.get("token").is_none());
        assert_eq!(welcome["state"]["open"], true);

        // Zapomnienie telefonu zamyka połączenia i unieważnia token
        server.forget(None);
        assert_eq!(hear_t(&mut ws, "-").await["closed"], CLOSE_FORGOTTEN);
        assert_eq!(hear_t(&mut again, "-").await["closed"], CLOSE_FORGOTTEN);
        let mut old = connect(port).await;
        say(&mut old, json!({ "t": "hello", "token": token })).await;
        assert_eq!(hear(&mut old).await["code"], "auth");
        assert!(server.devices().is_empty());
    }

    #[tokio::test]
    async fn blokada_po_blednych_kodach() {
        let (server, port) = tv("blokada").await;
        let pin = server.pin();
        let wrong = if pin == "000000" { "111111" } else { "000000" };
        for i in 1..=MAX_FAILS {
            let mut ws = connect(port).await;
            say(&mut ws, json!({ "t": "hello", "name": "x", "pin": wrong })).await;
            assert_eq!(hear(&mut ws).await["code"], if i < MAX_FAILS { "pin" } else { "locked" });
        }
        // Dobry kod też już nie przejdzie, dopóki trwa blokada
        let mut ws = connect(port).await;
        say(&mut ws, json!({ "t": "hello", "name": "x", "pin": pin })).await;
        assert_eq!(hear(&mut ws).await["code"], "locked");
        assert!(server.devices().is_empty());
    }

    #[tokio::test]
    async fn nowy_pin_i_port() {
        let (server, port) = tv("pin").await;
        let old = server.pin();
        assert_eq!(old.len(), 6);
        let mut changes = server.changes();
        changes.borrow_and_update();
        let new = server.new_pin();
        assert!(changes.has_changed().unwrap());
        assert_eq!(server.pin(), new);
        // Zajęty port: czytelny błąd, bez paniki
        let (other, _) = tv("pin2").await;
        assert!(other.start(port).await.unwrap_err().contains("zajęty"));
        assert!(!other.error().is_empty());
    }
}
