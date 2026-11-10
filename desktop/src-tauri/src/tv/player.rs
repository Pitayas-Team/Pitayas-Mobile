// Odtwarzacz: strona serwisu VOD w zainstalowanej przeglądarce (Chrome — ma Widevine i zwykły User-Agent komputera),
// uruchomionej w trybie kiosku z własnym profilem. Polecenia pilota zamieniamy na klawisze, mysz i sterowanie <video>
// przez protokół DevTools (CDP) na gnieździe lokalnym.
// Okno Tauri (WebKitGTK) nie ma Widevine, dlatego film nie gra w oknie aplikacji.
use crate::services::{check_url, Service, KEY_STEP};
use futures_util::stream::SplitSink;
use futures_util::{SinkExt, StreamExt};
use pitayas_core::{Logger, Settings};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;

// Kod wykonywany na stronie serwisu. Szuka największego <video>, także w shadow DOM (np. Disney+).
const FIND_VIDEO: &str = r#"(() => {
  const all = [];
  const walk = (root, depth) => {
    if (depth > 6) return;
    for (const v of root.querySelectorAll('video')) all.push(v);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
  };
  walk(document, 0);
  const ok = all.filter((v) => v.readyState > 0 || v.currentSrc);
  ok.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  return ok[0] || null;
})()"#;

fn read_state_js() -> String {
    format!(
        "(() => {{ const v = {FIND_VIDEO}; if (!v) return null; return {{ paused: v.paused, time: Math.round(v.currentTime || 0), \
         duration: isFinite(v.duration) ? Math.round(v.duration) : 0, volume: Math.round(v.volume * 100) / 100, muted: v.muted, \
         fullscreen: Boolean(document.fullscreenElement) }}; }})()"
    )
}

fn video_js(body: &str) -> String {
    format!("(() => {{ const v = {FIND_VIDEO}; if (!v) return false; {body}; return true; }})()")
}

// Kursor rysowany na stronie — wstrzyknięte zdarzenia myszy nie ruszają kursora systemu
fn cursor_js(x: f64, y: f64) -> String {
    format!(
        r#"(() => {{
  let c = document.getElementById('__pitayas_cursor');
  if (!c) {{
    c = document.createElement('div');
    c.id = '__pitayas_cursor';
    c.style.cssText = 'position:fixed;z-index:2147483647;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#ff4fa6;border:3px solid #fff;pointer-events:none;transition:opacity .3s';
    document.documentElement.appendChild(c);
  }}
  c.style.left = '{x}px'; c.style.top = '{y}px'; c.style.opacity = '1';
  clearTimeout(window.__pitayas_cursor_t);
  window.__pitayas_cursor_t = setTimeout(() => {{ c.style.opacity = '0'; }}, 4000);
}})()"#
    )
}

/// nazwa z pilota → (key, code, kod klawisza, wpisywany znak)
fn key_def(name: &str) -> Option<(&'static str, &'static str, u32, Option<&'static str>)> {
    Some(match name {
        "up" => ("ArrowUp", "ArrowUp", 38, None),
        "down" => ("ArrowDown", "ArrowDown", 40, None),
        "left" => ("ArrowLeft", "ArrowLeft", 37, None),
        "right" => ("ArrowRight", "ArrowRight", 39, None),
        "enter" => ("Enter", "Enter", 13, Some("\r")),
        "back" | "esc" => ("Escape", "Escape", 27, None),
        "space" => (" ", "Space", 32, Some(" ")),
        "tab" => ("Tab", "Tab", 9, None),
        "backspace" => ("Backspace", "Backspace", 8, None),
        "f" => ("f", "KeyF", 70, Some("f")),
        "m" => ("m", "KeyM", 77, Some("m")),
        _ => return None,
    })
}

// ───── Uchwyt dla serwera i okna ─────

pub enum Req {
    Open { url: String, title: String, reply: oneshot::Sender<Result<(), String>> },
    Cmd { action: String, value: Value, reply: oneshot::Sender<Result<(), String>> },
}

/// Odtwarzacz widziany z zewnątrz: zlecenia idą kanałem, stan jest w `watch` (ostatnia wartość + powiadomienia)
#[derive(Clone)]
pub struct PlayerHandle {
    tx: mpsc::UnboundedSender<Req>,
    state: watch::Receiver<Value>,
}

impl PlayerHandle {
    /// Sam kanał bez odtwarzacza — drugi koniec obsługuje `spawn` (albo udawany odtwarzacz w testach)
    pub fn channel() -> (PlayerHandle, mpsc::UnboundedReceiver<Req>, watch::Sender<Value>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let (state_tx, state) = watch::channel(json!({ "open": false }));
        (PlayerHandle { tx, state }, rx, state_tx)
    }
    pub async fn open(&self, url: String, title: String) -> Result<(), String> {
        let (reply, done) = oneshot::channel();
        self.tx.send(Req::Open { url, title, reply }).map_err(|_| "Odtwarzacz nie działa".to_string())?;
        done.await.map_err(|_| "Odtwarzacz nie odpowiedział".to_string())?
    }
    pub async fn command(&self, action: &str, value: Value) -> Result<(), String> {
        let (reply, done) = oneshot::channel();
        self.tx.send(Req::Cmd { action: action.into(), value, reply }).map_err(|_| "Odtwarzacz nie działa".to_string())?;
        done.await.map_err(|_| "Odtwarzacz nie odpowiedział".to_string())?
    }
    pub fn state(&self) -> Value {
        self.state.borrow().clone()
    }
    pub fn subscribe(&self) -> watch::Receiver<Value> {
        self.state.clone()
    }
    pub fn is_open(&self) -> bool {
        self.state.borrow()["open"].as_bool().unwrap_or(false)
    }
}

// ───── Przeglądarka ─────

/// (polecenie, nazwa, czy ma Widevine)
const BROWSERS: &[(&str, &str, bool)] = &[
    ("google-chrome-stable", "Google Chrome", true),
    ("google-chrome", "Google Chrome", true),
    ("microsoft-edge-stable", "Microsoft Edge", true),
    ("brave-browser", "Brave", true),
    ("vivaldi-stable", "Vivaldi", true),
    ("chromium-browser", "Chromium", false),
    ("chromium", "Chromium", false),
];

pub struct BrowserInfo {
    pub path: PathBuf,
    pub name: String,
    pub drm: bool,
}

/// Przeglądarka do odtwarzania: wskazana w ustawieniach („browser”) albo pierwsza znaleziona
pub fn find_browser(settings: &Settings) -> Option<BrowserInfo> {
    let own = settings.get_str("browser");
    if !own.trim().is_empty() {
        let path = PathBuf::from(own.trim());
        let path = if path.is_absolute() { path } else { pitayas_core::util::which(own.trim())? };
        if !path.exists() {
            return None;
        }
        let file = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let known = BROWSERS.iter().find(|b| b.0 == file);
        return Some(BrowserInfo { name: known.map(|b| b.1.to_string()).unwrap_or(file), drm: known.map(|b| b.2).unwrap_or(true), path });
    }
    BROWSERS.iter().find_map(|(cmd, name, drm)| pitayas_core::util::which(cmd).map(|path| BrowserInfo { path, name: name.to_string(), drm: *drm }))
}

/// Czy jest przeglądarka z Widevine (Netflix, Disney+ itd.); bez niej film gra we własnym oknie aplikacji
pub fn drm_ready(settings: &Settings) -> bool {
    find_browser(settings).map(|b| b.drm).unwrap_or(false)
}

/// Opis dla ekranu startowego i GET /info
pub fn browser_status(settings: &Settings) -> Value {
    match find_browser(settings) {
        Some(b) if b.drm => json!({ "ready": true, "text": format!("Odtwarzanie: {} (z Widevine)", b.name) }),
        Some(b) => json!({ "ready": false, "text": format!("{} bez Widevine — Netflix i podobne nie zagrają. Zainstaluj Google Chrome.", b.name) }),
        None => json!({ "ready": false, "text": "Brak przeglądarki do odtwarzania — zainstaluj Google Chrome" }),
    }
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// Połączenie DevTools: odpowiedzi trafiają do czekających wywołań, zdarzenia do kanału odtwarzacza
struct Cdp {
    sink: tokio::sync::Mutex<SplitSink<Ws, Message>>,
    pending: Pending,
    next: AtomicU64,
    reader: tokio::task::JoinHandle<()>,
}

impl Cdp {
    async fn connect(url: &str, events: mpsc::UnboundedSender<Value>) -> Result<Cdp, String> {
        let (ws, _) = tokio_tungstenite::connect_async(url).await.map_err(|e| format!("Brak połączenia z przeglądarką: {e}"))?;
        let (sink, mut stream) = ws.split();
        let pending: Pending = Arc::default();
        let waiting = pending.clone();
        let reader = tokio::spawn(async move {
            while let Some(Ok(msg)) = stream.next().await {
                let Message::Text(text) = msg else { continue };
                let Ok(v) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                match v["id"].as_u64() {
                    Some(id) => {
                        if let Some(tx) = waiting.lock().unwrap().remove(&id) {
                            let _ = tx.send(match v.get("error") {
                                Some(e) => Err(e["message"].as_str().unwrap_or("błąd przeglądarki").to_string()),
                                None => Ok(v["result"].clone()),
                            });
                        }
                    }
                    None => {
                        let _ = events.send(v);
                    }
                }
            }
            waiting.lock().unwrap().clear();
        });
        Ok(Cdp { sink: tokio::sync::Mutex::new(sink), pending, next: AtomicU64::new(1), reader })
    }

    async fn call(&self, session: Option<&str>, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let mut msg = json!({ "id": id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if self.sink.lock().await.send(Message::Text(msg.to_string().into())).await.is_err() {
            self.pending.lock().unwrap().remove(&id);
            return Err("Przeglądarka się rozłączyła".into());
        }
        match tokio::time::timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("Przeglądarka się rozłączyła".into()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err("Przeglądarka nie odpowiada".into())
            }
        }
    }
}

impl Drop for Cdp {
    fn drop(&mut self) {
        self.reader.abort();
    }
}

struct Browser {
    child: tokio::process::Child,
    cdp: Cdp,
    /// sesja DevTools głównej strony
    page: String,
    /// konteksty JS ramek: (sesja, id kontekstu) — <video> bywa w ramce (iframe)
    contexts: Vec<(String, i64)>,
}

impl Browser {
    async fn page_call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.cdp.call(Some(&self.page), method, params).await
    }

    async fn eval_in(&self, session: &str, context: Option<i64>, code: &str, gesture: bool) -> Option<Value> {
        let mut params = json!({ "expression": code, "returnByValue": true, "userGesture": gesture });
        if let Some(c) = context {
            params["contextId"] = json!(c);
        }
        let r = self.cdp.call(Some(session), "Runtime.evaluate", params).await.ok()?;
        if r.get("exceptionDetails").is_some() {
            return None;
        }
        r["result"].get("value").cloned()
    }

    /// Pyta główną stronę, a potem wszystkie ramki — zwraca pierwszą odpowiedź, która coś ma
    async fn eval_any(&self, code: &str, gesture: bool) -> Option<Value> {
        let truthy = |v: &Value| !(v.is_null() || *v == Value::Bool(false));
        if let Some(v) = self.eval_in(&self.page, None, code, gesture).await.filter(truthy) {
            return Some(v);
        }
        for (session, ctx) in &self.contexts {
            if let Some(v) = self.eval_in(session, Some(*ctx), code, gesture).await.filter(truthy) {
                return Some(v);
            }
        }
        None
    }

    async fn key(&self, name: &str) {
        let Some((key, code, vk, text)) = key_def(name) else { return };
        let mut down = json!({ "type": if text.is_some() { "keyDown" } else { "rawKeyDown" }, "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk });
        if let Some(t) = text {
            down["text"] = json!(t);
        }
        let _ = self.page_call("Input.dispatchKeyEvent", down).await;
        let _ = self.page_call("Input.dispatchKeyEvent", json!({ "type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk })).await;
    }
}

struct Current {
    url: String,
    host: String,
    title: String,
    fixed_title: bool,
    service: Option<&'static Service>,
}

struct Actor {
    settings: Settings,
    log: Logger,
    data_dir: PathBuf,
    state_tx: watch::Sender<Value>,
    events_tx: mpsc::UnboundedSender<Value>,
    browser: Option<Browser>,
    current: Option<Current>,
    video: Value,
    /// głośność systemu (PipeWire): { volume 0–1, muted }
    system: Value,
    has_wpctl: Option<bool>,
    pointer: (f64, f64),
    size: (f64, f64),
}

fn num(v: &Value, min: f64, max: f64) -> f64 {
    v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).filter(|n| n.is_finite()).unwrap_or(0.0).clamp(min, max)
}

async fn wpctl(args: &[&str]) -> Option<String> {
    let run = tokio::process::Command::new("wpctl").args(args).stdin(std::process::Stdio::null()).output();
    let out = tokio::time::timeout(Duration::from_secs(3), run).await.ok()?.ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

impl Actor {
    fn state(&self) -> Value {
        let Some(c) = &self.current else { return json!({ "open": false, "system": self.system }) };
        json!({
            "open": true, "url": c.url, "host": c.host, "title": c.title,
            "service": c.service.map(|s| json!({ "id": s.id, "name": s.name, "seek": if s.seek_keys { "keys" } else { "time" } })),
            "video": self.video, "system": self.system,
        })
    }

    fn publish(&self) {
        let s = self.state();
        self.state_tx.send_if_modified(|old| {
            if *old == s {
                return false;
            }
            *old = s;
            true
        });
    }

    async fn read_system(&mut self) {
        if self.has_wpctl == Some(false) {
            return;
        }
        match wpctl(&["get-volume", "@DEFAULT_AUDIO_SINK@"]).await {
            Some(out) => {
                self.has_wpctl = Some(true);
                let vol = out.split_whitespace().nth(1).and_then(|s| s.parse::<f64>().ok());
                self.system = match vol {
                    Some(v) => json!({ "volume": v.min(1.0), "muted": out.contains("MUTED") }),
                    None => Value::Null,
                };
            }
            None => {
                self.has_wpctl = Some(false);
                self.system = Value::Null;
            }
        }
    }

    async fn launch(&mut self, url: &str) -> Result<(), String> {
        let found = find_browser(&self.settings).ok_or("Na telewizorze nie ma przeglądarki do odtwarzania — zainstaluj Google Chrome")?;
        let profile = self.data_dir.join("browser");
        std::fs::create_dir_all(&profile).map_err(|e| format!("Folder profilu: {e}"))?;
        let port_file = profile.join("DevToolsActivePort");
        let _ = std::fs::remove_file(&port_file);
        // Przeglądarka z naszym profilem została po poprzednim uruchomieniu (np. po awarii aplikacji) — nowa oddałaby jej
        // adres i od razu się zamknęła, więc starą kończymy. SingletonLock to dowiązanie „komputer-PID”.
        if let Some(pid) = std::fs::read_link(profile.join("SingletonLock")).ok().and_then(|l| l.to_string_lossy().rsplit('-').next().and_then(|p| p.parse::<u32>().ok())) {
            if pitayas_core::util::pid_alive(pid) {
                self.log.warn("Zamykam przeglądarkę pozostałą po poprzednim uruchomieniu");
                let _ = tokio::process::Command::new("kill").arg(pid.to_string()).status().await;
                tokio::time::sleep(Duration::from_millis(800)).await;
            }
        }

        let mut cmd = tokio::process::Command::new(&found.path);
        cmd.arg(format!("--user-data-dir={}", profile.display()))
            .arg("--remote-debugging-port=0") // port wybiera system; słucha tylko na 127.0.0.1
            .arg(format!("--app={url}"))
            .args(["--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble", "--hide-crash-restore-bubble"])
            .args(["--autoplay-policy=no-user-gesture-required", "--disable-features=TranslateUI", "--ozone-platform-hint=auto", "--class=pitayas-watch-player"]);
        if self.settings.get("fullscreen") != Value::Bool(false) && !std::env::args().any(|a| a == "--windowed") {
            cmd.args(["--kiosk", "--start-fullscreen"]);
        } else {
            cmd.arg("--window-size=1280,720");
        }
        cmd.args(self.settings.get_str("browserArgs").split_whitespace());
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| format!("Nie udało się uruchomić {}: {e}", found.name))?;
        self.log.info(format!("Przeglądarka: {} ({})", found.name, found.path.display()));

        // Przeglądarka zapisuje w profilu port DevTools i ścieżkę gniazda
        let mut ws_url = None;
        for _ in 0..150 {
            if let Ok(text) = std::fs::read_to_string(&port_file) {
                let mut lines = text.lines();
                if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                    ws_url = Some(format!("ws://127.0.0.1:{}{}", port.trim(), path.trim()));
                    break;
                }
            }
            if let Ok(Some(_)) = child.try_wait() {
                return Err(format!("{} zamknął się zaraz po starcie", found.name));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let ws_url = ws_url.ok_or(format!("{} nie udostępnił sterowania (DevTools)", found.name))?;
        let cdp = Cdp::connect(&ws_url, self.events_tx.clone()).await?;

        let mut target = None;
        for _ in 0..50 {
            let list = cdp.call(None, "Target.getTargets", json!({})).await?;
            target = list["targetInfos"].as_array().and_then(|a| a.iter().find(|t| t["type"] == "page")).and_then(|t| t["targetId"].as_str().map(String::from));
            if target.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let target = target.ok_or("Przeglądarka nie otworzyła strony")?;
        let page = cdp.call(None, "Target.attachToTarget", json!({ "targetId": target, "flatten": true })).await?["sessionId"]
            .as_str()
            .ok_or("Brak sesji strony")?
            .to_string();
        let browser = Browser { child, cdp, page, contexts: vec![] };
        // Konteksty ramek (Runtime) i ramki z innych domen (osobne sesje) — zgłoszą się zdarzeniami
        let _ = browser.page_call("Runtime.enable", json!({})).await;
        let _ = browser.page_call("Target.setAutoAttach", json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true })).await;
        self.browser = Some(browser);
        Ok(())
    }

    async fn on_event(&mut self, ev: Value) {
        let Some(b) = self.browser.as_mut() else { return };
        let session = ev["sessionId"].as_str().unwrap_or("").to_string();
        let p = &ev["params"];
        match ev["method"].as_str().unwrap_or("") {
            "Runtime.executionContextCreated" => {
                let c = &p["context"];
                if c["auxData"]["isDefault"] == true {
                    if let Some(id) = c["id"].as_i64() {
                        b.contexts.push((session, id));
                    }
                }
            }
            "Runtime.executionContextDestroyed" => {
                let id = p["executionContextId"].as_i64();
                b.contexts.retain(|(s, c)| !(s == &session && Some(*c) == id));
            }
            "Runtime.executionContextsCleared" => b.contexts.retain(|(s, _)| s != &session),
            "Target.attachedToTarget" => {
                // Ramka z innej domeny (np. odtwarzacz w iframe) ma własną sesję
                if let Some(child) = p["sessionId"].as_str() {
                    let _ = b.cdp.call(Some(child), "Runtime.enable", json!({})).await;
                    let _ = b.cdp.call(Some(child), "Target.setAutoAttach", json!({ "autoAttach": true, "waitForDebuggerOnStart": false, "flatten": true })).await;
                }
            }
            "Target.detachedFromTarget" => {
                let gone = p["sessionId"].as_str().unwrap_or("");
                b.contexts.retain(|(s, _)| s != gone);
            }
            _ => {}
        }
    }

    async fn poll(&mut self) {
        let Some(b) = self.browser.as_mut() else { return };
        // Ktoś zamknął przeglądarkę na telewizorze (Alt+F4, Ctrl+W)
        if !matches!(b.child.try_wait(), Ok(None)) {
            self.close().await;
            return;
        }
        let main = b.eval_in(&b.page, None, "({ url: location.href, title: document.title, w: innerWidth, h: innerHeight })", false).await;
        let video = b.eval_any(&read_state_js(), false).await.unwrap_or(Value::Null);
        self.video = video;
        if let (Some(m), Some(c)) = (main, self.current.as_mut()) {
            if let Some(u) = m["url"].as_str().filter(|u| u.starts_with("http")) {
                c.url = u.to_string();
                if let Some(h) = url::Url::parse(u).ok().and_then(|x| x.host_str().map(String::from)) {
                    c.host = h;
                }
            }
            if let Some(t) = m["title"].as_str().filter(|t| !c.fixed_title && !t.is_empty()) {
                c.title = t.to_string();
            }
            self.size = (m["w"].as_f64().unwrap_or(1280.0), m["h"].as_f64().unwrap_or(720.0));
        }
        self.publish();
    }

    async fn open(&mut self, url: &str, title: &str) -> Result<(), String> {
        let any_host = self.settings.get("anyHost") == Value::Bool(true);
        let c = check_url(url, any_host)?;
        self.log.info(format!("Otwieram: {}", c.host));
        if let Some(b) = &self.browser {
            b.page_call("Page.navigate", json!({ "url": c.url })).await?;
            let _ = b.page_call("Page.bringToFront", json!({})).await;
        } else if let Err(e) = self.launch(&c.url).await {
            self.log.warn(format!("Odtwarzacz: {e}"));
            return Err(e);
        }
        let name = c.service.map(|s| s.name.to_string()).unwrap_or_else(|| c.host.clone());
        self.current = Some(Current { url: c.url, host: c.host, title: if title.is_empty() { name } else { title.to_string() }, fixed_title: !title.is_empty(), service: c.service });
        self.video = Value::Null;
        self.pointer = (self.size.0 / 2.0, self.size.1 / 2.0);
        self.read_system().await;
        self.publish();
        Ok(())
    }

    async fn close(&mut self) {
        if let Some(mut b) = self.browser.take() {
            let _ = tokio::time::timeout(Duration::from_secs(1), b.cdp.call(None, "Browser.close", json!({}))).await;
            if tokio::time::timeout(Duration::from_secs(3), b.child.wait()).await.is_err() {
                let _ = b.child.kill().await;
            }
        }
        self.current = None;
        self.video = Value::Null;
        self.publish();
    }

    async fn seek(&self, b: &Browser, seconds: f64) {
        // Netflix, Disney+, Prime: strzałki (krok serwisu, zwykle 10 s); pozostałe: czas elementu <video>
        let dir = if seconds < 0.0 { "left" } else { "right" };
        if self.current.as_ref().and_then(|c| c.service).is_some_and(|s| s.seek_keys) {
            let n = ((seconds.abs() / KEY_STEP).round() as u32).clamp(1, 12);
            for _ in 0..n {
                b.key(dir).await;
            }
            return;
        }
        let code = video_js(&format!("v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + ({seconds})))"));
        if b.eval_any(&code, true).await.is_none() {
            b.key(dir).await;
        }
    }

    async fn command(&mut self, action: &str, value: &Value) -> Result<(), String> {
        if action == "stop" {
            self.close().await;
            return Ok(());
        }
        if self.browser.is_none() {
            return Err("Na telewizorze nic nie jest otwarte".into());
        }
        if matches!(action, "volume" | "mute") && self.has_wpctl.is_none() {
            self.read_system().await;
        }
        let system = self.has_wpctl == Some(true);
        let b = self.browser.as_ref().unwrap();
        match action {
            "playpause" => {
                // Najpierw wprost na <video>; gdy go nie widać (własny odtwarzacz serwisu) — spacja
                if b.eval_any(&video_js("v.paused ? v.play() : v.pause()"), true).await.is_none() {
                    b.key("space").await;
                }
            }
            "play" => drop(b.eval_any(&video_js("v.play()"), true).await),
            "pause" => drop(b.eval_any(&video_js("v.pause()"), true).await),
            "seek" => self.seek(b, num(value, -600.0, 600.0)).await,
            "seekto" => {
                if let Some(s) = self.current.as_ref().and_then(|c| c.service).filter(|s| s.seek_keys) {
                    return Err(format!("{}: przewijaj przyciskami ±10 s", s.name));
                }
                b.eval_any(&video_js(&format!("v.currentTime = {}", num(value, 0.0, 86400.0))), true).await;
            }
            "volume" => {
                let delta = num(value, -1.0, 1.0);
                if system {
                    let step = format!("{}%{}", (delta.abs() * 100.0).round(), if delta < 0.0 { "-" } else { "+" });
                    wpctl(&["set-volume", "-l", "1.0", "@DEFAULT_AUDIO_SINK@", &step]).await;
                } else {
                    b.eval_any(&video_js(&format!("v.muted = false; v.volume = Math.max(0, Math.min(1, v.volume + ({delta})))")), true).await;
                }
            }
            "mute" => {
                if system {
                    wpctl(&["set-mute", "@DEFAULT_AUDIO_SINK@", "toggle"]).await;
                } else {
                    b.eval_any(&video_js("v.muted = !v.muted"), true).await;
                }
            }
            "fullscreen" => b.key("f").await,
            "key" => {
                let name = value.as_str().unwrap_or("");
                if key_def(name).is_none() {
                    return Err("Nieznany klawisz".into());
                }
                b.key(name).await;
            }
            "text" => {
                let text: String = value.as_str().unwrap_or("").chars().take(500).collect();
                b.page_call("Input.insertText", json!({ "text": text })).await?;
            }
            "move" => {
                let x = (self.pointer.0 + num(&value["dx"], -2000.0, 2000.0)).clamp(0.0, self.size.0 - 1.0).round();
                let y = (self.pointer.1 + num(&value["dy"], -2000.0, 2000.0)).clamp(0.0, self.size.1 - 1.0).round();
                let _ = b.page_call("Input.dispatchMouseEvent", json!({ "type": "mouseMoved", "x": x, "y": y })).await;
                let _ = b.eval_in(&b.page, None, &cursor_js(x, y), false).await;
                self.pointer = (x, y);
                return Ok(()); // bez odświeżania stanu — ruchów jest dużo
            }
            "click" => {
                let (x, y) = self.pointer;
                for kind in ["mousePressed", "mouseReleased"] {
                    let _ = b.page_call("Input.dispatchMouseEvent", json!({ "type": kind, "x": x, "y": y, "button": "left", "clickCount": 1 })).await;
                }
            }
            "scroll" => {
                let (x, y) = self.pointer;
                let _ = b.page_call("Input.dispatchMouseEvent", json!({ "type": "mouseWheel", "x": x, "y": y, "deltaX": 0, "deltaY": -num(value, -3000.0, 3000.0) })).await;
                return Ok(());
            }
            "reload" => drop(b.page_call("Page.reload", json!({})).await),
            _ => return Err("Nieznane polecenie".into()),
        }
        if matches!(action, "volume" | "mute") && system {
            self.read_system().await;
        }
        // Telefon widzi skutek od razu, nie dopiero przy następnym odczycie
        tokio::time::sleep(Duration::from_millis(150)).await;
        self.poll().await;
        Ok(())
    }
}

/// Uruchamia odtwarzacz w tle. `data_dir` — folder danych aplikacji (profil przeglądarki z logowaniami do serwisów).
pub fn spawn(settings: Settings, log: Logger, data_dir: PathBuf) -> PlayerHandle {
    let (handle, mut rx, state_tx) = PlayerHandle::channel();
    let (events_tx, mut events_rx) = mpsc::unbounded_channel();
    let mut a = Actor {
        settings, log, data_dir, state_tx, events_tx,
        browser: None, current: None, video: Value::Null, system: Value::Null, has_wpctl: None,
        pointer: (640.0, 360.0), size: (1280.0, 720.0),
    };
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                req = rx.recv() => match req {
                    Some(Req::Open { url, title, reply }) => { let _ = reply.send(a.open(&url, &title).await); }
                    Some(Req::Cmd { action, value, reply }) => { let _ = reply.send(a.command(&action, &value).await); }
                    None => { a.close().await; break; }
                },
                Some(ev) = events_rx.recv() => a.on_event(ev).await,
                _ = tick.tick() => a.poll().await,
            }
        }
    });
    handle
}
