// Kanał sterowania — ten sam protokół co control.js:
//   Linux/macOS: ~/.config/Pitayas/run/<id>.sock     Windows: \\.\pipe\pitayas-<id>
//   → {"id":1,"cmd":"ping","args":{}}
//   ← {"id":1,"ok":true,"result":…}   albo   {"id":1,"ok":false,"error":"…"}
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

pub type Handler = Arc<dyn Fn(Value) -> Result<Value, String> + Send + Sync>;
pub type Handlers = Arc<RwLock<HashMap<String, Handler>>>;

pub fn socket_path(run_dir: &Path, id: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(format!(r"\\.\pipe\pitayas-{id}"))
    } else {
        run_dir.join(format!("{id}.sock"))
    }
}

async fn session<S: AsyncRead + AsyncWrite + Unpin>(stream: S, handlers: Handlers) {
    let (r, mut w) = tokio::io::split(stream);
    let mut lines = BufReader::new(r).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.len() > 1_000_000 {
            break;
        }
        let reply = match serde_json::from_str::<Value>(line) {
            Err(_) => json!({ "ok": false, "error": "Niepoprawny JSON" }),
            Ok(msg) => {
                let cmd = msg["cmd"].as_str().unwrap_or("").to_string();
                let fun = handlers.read().unwrap().get(&cmd).cloned();
                let body = match fun {
                    None => json!({ "ok": false, "error": format!("Nieznane polecenie: {cmd}") }),
                    Some(f) => match f(msg.get("args").cloned().unwrap_or(json!({}))) {
                        Ok(v) => json!({ "ok": true, "result": v }),
                        Err(e) => json!({ "ok": false, "error": e }),
                    },
                };
                let mut body = body;
                body["id"] = msg.get("id").cloned().unwrap_or(Value::Null);
                body
            }
        };
        if w.write_all(format!("{reply}\n").as_bytes()).await.is_err() {
            break;
        }
    }
}

/// Start serwera w tle (wymaga działającego środowiska tokio, np. tauri::async_runtime)
pub async fn serve(file: PathBuf, handlers: Handlers) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        let _ = std::fs::remove_file(&file);
        let listener = tokio::net::UnixListener::bind(&file)?;
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
        loop {
            let (sock, _) = listener.accept().await?;
            tokio::spawn(session(sock, handlers.clone()));
        }
    }
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ServerOptions;
        let name = file.to_string_lossy().to_string();
        let mut server = ServerOptions::new().first_pipe_instance(true).create(&name)?;
        loop {
            server.connect().await?;
            let connected = server;
            server = ServerOptions::new().create(&name)?;
            tokio::spawn(session(connected, handlers.clone()));
        }
    }
}

/// Jedno polecenie do innej aplikacji Pitayas
pub async fn call(file: &Path, cmd: &str, args: Value, timeout_ms: u64) -> Result<Value, String> {
    let work = async {
        #[cfg(unix)]
        let stream = tokio::net::UnixStream::connect(file).await.map_err(|_| "Aplikacja nie jest uruchomiona".to_string())?;
        #[cfg(windows)]
        let stream = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(file.to_string_lossy().as_ref())
            .map_err(|_| "Aplikacja nie jest uruchomiona".to_string())?;
        let (r, mut w) = tokio::io::split(stream);
        w.write_all(format!("{}\n", json!({ "id": 1, "cmd": cmd, "args": args })).as_bytes()).await.map_err(|e| e.to_string())?;
        let mut line = String::new();
        BufReader::new(r).read_line(&mut line).await.map_err(|e| e.to_string())?;
        let msg: Value = serde_json::from_str(&line).map_err(|_| "Niepoprawna odpowiedź".to_string())?;
        if msg["ok"].as_bool() == Some(true) {
            Ok(msg["result"].clone())
        } else {
            Err(msg["error"].as_str().unwrap_or("Błąd aplikacji").to_string())
        }
    };
    tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), work).await.map_err(|_| "Aplikacja nie odpowiada".to_string())?
}
