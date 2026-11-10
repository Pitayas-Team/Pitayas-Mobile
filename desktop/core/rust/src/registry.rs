// Rejestr aplikacji — ten sam układ plików co registry.js:
//   apps/<id>.json   wpis aplikacji (zapisywany przy każdym starcie)
//   run/<id>.json    tylko gdy działa: pid, start, adres gniazda sterowania, status
//   core.json        stary zbiorczy spis (zostaje dla zgodności)
use crate::util::{now_iso, pid_alive, read_json, write_json};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const SCHEMA: u32 = 2;

pub struct Dirs {
    pub root: PathBuf,
    pub apps: PathBuf,
    pub run: PathBuf,
    pub core_file: PathBuf,
}

pub fn dirs(root: &Path) -> Dirs {
    Dirs { root: root.to_path_buf(), apps: root.join("apps"), run: root.join("run"), core_file: root.join("core.json") }
}

pub fn register(mut entry: Value, root: &Path) -> Value {
    let d = dirs(root);
    entry["schema"] = json!(SCHEMA);
    entry["lastRun"] = json!(now_iso());
    let id = entry["id"].as_str().unwrap_or("").to_string();
    let _ = write_json(&d.apps.join(format!("{id}.json")), &entry);
    let mut reg = read_json(&d.core_file).unwrap_or(json!({ "apps": {} }));
    if !reg["apps"].is_object() {
        reg["apps"] = json!({});
    }
    reg["apps"][&id] = json!({
        "name": entry["name"], "folder": entry["folder"], "version": entry["version"],
        "executable": entry["executable"], "packaged": entry["packaged"], "lastRun": entry["lastRun"],
    });
    reg["coreVersion"] = entry["coreVersion"].clone();
    reg["schema"] = json!(SCHEMA);
    let _ = write_json(&d.core_file, &reg);
    entry
}

/// Plik „działam” — znika przy zamknięciu; po awarii rozpoznajemy go po martwym pid
#[derive(Clone)]
pub struct Running {
    file: PathBuf,
    state: Arc<Mutex<Value>>,
}

impl Running {
    pub fn update_status(&self, patch: Value) -> Value {
        let mut st = self.state.lock().unwrap();
        if let (Some(cur), Value::Object(p)) = (st["status"].as_object_mut(), patch) {
            cur.extend(p);
        }
        st["updatedAt"] = json!(now_iso());
        let _ = write_json(&self.file, &st);
        st["status"].clone()
    }
    pub fn status(&self) -> Value {
        self.state.lock().unwrap()["status"].clone()
    }
    pub fn clear(&self) {
        let mine = read_json(&self.file).map(|c| c["pid"].as_u64() == Some(std::process::id() as u64)).unwrap_or(true);
        if mine {
            let _ = std::fs::remove_file(&self.file);
        }
    }
}

pub fn mark_running(id: &str, info: Value, root: &Path) -> Running {
    let d = dirs(root);
    let file = d.run.join(format!("{id}.json"));
    let mut state = json!({
        "id": id, "pid": std::process::id(), "startedAt": now_iso(),
        "control": crate::control::socket_path(&d.run, id).to_string_lossy(), "status": {},
    });
    if let (Some(s), Value::Object(i)) = (state.as_object_mut(), info) {
        s.extend(i);
    }
    let _ = write_json(&file, &state);
    Running { file, state: Arc::new(Mutex::new(state)) }
}

pub fn run_state(id: &str, root: &Path) -> Option<Value> {
    let st = read_json(&dirs(root).run.join(format!("{id}.json")))?;
    let pid = st["pid"].as_u64().unwrap_or(0) as u32;
    // pid równy naszemu to plik zostawiony po awarii poprzedniego startu (w kontenerze każdy proces to PID 1)
    if pid != std::process::id() && pid_alive(pid) {
        Some(st)
    } else {
        None
    }
}

/// Wszystkie aplikacje Pitayas na tym komputerze (i które z nich działają)
pub fn list_apps(root: &Path) -> Vec<Value> {
    let d = dirs(root);
    let mut out = serde_json::Map::new();
    if let Ok(rd) = std::fs::read_dir(&d.apps) {
        for e in rd.flatten() {
            if e.path().extension().map(|x| x == "json").unwrap_or(false) {
                if let Some(v) = read_json(&e.path()) {
                    if let Some(id) = v["id"].as_str() {
                        out.insert(id.to_string(), v.clone());
                    }
                }
            }
        }
    }
    if let Some(Value::Object(legacy)) = read_json(&d.core_file).map(|r| r["apps"].clone()) {
        for (id, e) in legacy {
            if !out.contains_key(&id) {
                let mut v = e.clone();
                v["id"] = json!(id);
                v["legacy"] = json!(true);
                out.insert(id, v);
            }
        }
    }
    let mut list: Vec<Value> = out
        .into_values()
        .map(|mut e| {
            let run = run_state(e["id"].as_str().unwrap_or(""), root);
            e["running"] = json!(run.is_some());
            e["run"] = run.unwrap_or(Value::Null);
            e
        })
        .collect();
    list.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    list
}

pub async fn send(id: &str, cmd: &str, args: Value, root: &Path, timeout_ms: u64) -> Result<Value, String> {
    let run = run_state(id, root).ok_or("Aplikacja nie jest uruchomiona")?;
    let sock = PathBuf::from(run["control"].as_str().unwrap_or(""));
    crate::control::call(&sock, cmd, args, timeout_ms).await
}

/// Uruchomienie innej aplikacji (albo pokazanie okna, gdy już działa)
pub async fn launch(id: &str, root: &Path) -> Result<Value, String> {
    let a = list_apps(root).into_iter().find(|a| a["id"] == id).ok_or(format!("Nie znam aplikacji „{id}”"))?;
    if a["running"] == true {
        let _ = send(id, "show", json!({}), root, 3000).await;
        return Ok(json!({ "already": true }));
    }
    let l = if a["launch"].is_object() { a["launch"].clone() } else { json!({ "command": a["executable"], "args": [] }) };
    let cmd = l["command"].as_str().unwrap_or("");
    if cmd.is_empty() || !Path::new(cmd).exists() {
        return Err(format!("Nie znaleziono programu: {cmd}"));
    }
    let args: Vec<String> = l["args"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
    let mut c = std::process::Command::new(cmd);
    c.args(args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    if let Some(cwd) = l["cwd"].as_str() {
        c.current_dir(cwd);
    }
    let child = c.spawn().map_err(|e| e.to_string())?;
    Ok(json!({ "pid": child.id() }))
}
