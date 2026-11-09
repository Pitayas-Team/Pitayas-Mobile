// ═══════ PITAYAS USB (iPhone) ═══════
// iPhone nie ma „adb reverse”, więc to komputer łączy się z telefonem: przez kabel (usbmuxd) do portu na iPhonie.
// Słuchamy WebSocketów TYLKO na 127.0.0.1 telefonu (z Wi-Fi nikt się nie połączy) i przekazujemy wiadomości
// między dwiema stronami: komputerem ({"role":"pc"}) i modułem w aplikacji ({"role":"app"}).
// To samo robiła wtyczka PitayasUsb w Swifcie — tu w Rust, więc działa też na Androidzie i komputerze.
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::Mutex;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_tungstenite::tungstenite::Message;

#[derive(Default)]
struct Peers {
    pc: Option<(u64, UnboundedSender<Message>)>,
    app: Option<(u64, UnboundedSender<Message>)>,
}

#[derive(Default)]
pub struct Relay {
    task: Mutex<Option<(u16, tokio::task::JoinHandle<()>)>>,
}

static PEERS: Mutex<Peers> = Mutex::new(Peers { pc: None, app: None });
static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn text(s: &str) -> Message {
    Message::Text(s.to_string().into())
}

async fn session(stream: tokio::net::TcpStream) {
    let Ok(ws) = tokio_tungstenite::accept_async(stream).await else { return };
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let (mut sink, mut rx_ws) = ws.split();
    let (tx, mut rx) = unbounded_channel::<Message>();
    let writer = tokio::spawn(async move {
        while let Some(m) = rx.recv().await {
            if sink.send(m).await.is_err() {
                break;
            }
        }
    });
    let mut role: Option<&'static str> = None;
    while let Some(Ok(m)) = rx_ws.next().await {
        match &m {
            Message::Close(_) => break,
            Message::Text(t) if role.is_none() && t.contains("\"role\"") => {
                // Pierwsza wiadomość mówi, kto się połączył
                let mut p = PEERS.lock().unwrap();
                if t.contains("\"pc\"") {
                    role = Some("pc");
                    p.pc = Some((id, tx.clone()));
                    if let Some((_, a)) = &p.app {
                        let _ = a.send(text(r#"{"t":"peer","role":"pc","state":"up"}"#));
                    }
                } else {
                    role = Some("app");
                    p.app = Some((id, tx.clone()));
                    if p.pc.is_some() {
                        let _ = tx.send(text(r#"{"t":"peer","role":"pc","state":"up"}"#));
                    }
                }
            }
            Message::Text(_) | Message::Binary(_) => {
                let p = PEERS.lock().unwrap();
                let target = match role {
                    Some("pc") => p.app.as_ref(),
                    Some("app") => p.pc.as_ref(),
                    _ => None,
                };
                if let Some((_, t)) = target {
                    let _ = t.send(m.clone());
                }
            }
            _ => {}
        }
    }
    writer.abort();
    let mut p = PEERS.lock().unwrap();
    match role {
        Some("pc") if p.pc.as_ref().map(|x| x.0) == Some(id) => {
            p.pc = None;
            if let Some((_, a)) = &p.app {
                let _ = a.send(text(r#"{"t":"peer","role":"pc","state":"down"}"#));
            }
        }
        Some("app") if p.app.as_ref().map(|x| x.0) == Some(id) => {
            p.app = None;
            if let Some((_, c)) = &p.pc {
                let _ = c.send(text(r#"{"t":"peer","role":"app","state":"down"}"#));
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub async fn usb_start(relay: tauri::State<'_, Relay>, port: Option<u16>) -> Result<Value, String> {
    let port = port.unwrap_or(8195);
    if relay.task.lock().unwrap().as_ref().map(|(p, _)| *p == port).unwrap_or(false) {
        return Ok(json!({ "port": port }));
    }
    stop(&relay);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| format!("Nie mogę nasłuchiwać na porcie {port}: {e}"))?;
    let task = tokio::spawn(async move {
        while let Ok((s, _)) = listener.accept().await {
            tokio::spawn(session(s));
        }
    });
    *relay.task.lock().unwrap() = Some((port, task));
    Ok(json!({ "port": port }))
}

fn stop(relay: &Relay) {
    if let Some((_, t)) = relay.task.lock().unwrap().take() {
        t.abort();
    }
    *PEERS.lock().unwrap() = Peers::default();
}

#[tauri::command]
pub fn usb_stop(relay: tauri::State<'_, Relay>) {
    stop(&relay);
}
