// ═══════ PITAYAS NA KOMPUTER (Fedora / Linux) ═══════
// Ta sama aplikacja co na telefonie (../../www: rdzeń i moduły z aktualizacji OTA), plus „tryb telewizora” z Pitayas Watch:
//  • film z serwisu VOD gra w przeglądarce z Widevine (tv/player.rs), bo okno aplikacji (WebKitGTK) nie ma DRM,
//  • ten komputer może być telewizorem: telefon paruje się kodem i działa jak pilot (tv/server.rs, port 8197).
// Moduł Watch w oknie rozmawia z tą częścią przez polecenia tv_* (www/tauri-shim.js → window.PitayasDesktop).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[path = "../../../app/src-tauri/src/fs.rs"]
mod fs;
#[path = "tv/player.rs"]
mod player;
#[path = "tv/server.rs"]
mod server;
#[path = "tv/services.rs"]
mod services;

use pitayas_core::{Core, Options};
use player::PlayerHandle;
use serde_json::{json, Value};
use server::Server;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

struct Tv {
    core: Core,
    server: Server,
    player: PlayerHandle,
}

fn app_open_inapp() -> bool {
    INAPP_SINCE.lock().unwrap().is_some()
}

fn state(w: &Tv) -> Value {
    let settings = w.core.settings();
    json!({
        "port": w.server.port(),
        "addresses": server::addresses(),
        "host": server::host_name(),
        "error": w.server.error(),
        "pin": w.server.pin(),
        "devices": w.server.devices(),
        "anyHost": settings.get("anyHost") == Value::Bool(true),
        "fullscreen": settings.get("tvFullscreen") == Value::Bool(true),
        "drm": player::browser_status(settings),
        "services": services::SERVICES.iter().map(|s| s.name).collect::<Vec<_>>(),
        "player": w.player.state(),
        "inapp": app_open_inapp(),
        "drmReady": player::drm_ready(settings),
    })
}

#[tauri::command]
fn app_info(app: AppHandle) -> Value {
    let p = app.package_info();
    json!({ "name": p.name, "id": app.config().identifier, "version": p.version.to_string(), "build": p.version.to_string(), "platform": "linux" })
}
#[tauri::command]
fn tv_state(w: tauri::State<'_, Tv>) -> Value {
    state(&w)
}
#[tauri::command]
fn tv_new_pin(w: tauri::State<'_, Tv>) -> Value {
    w.server.new_pin();
    state(&w)
}
#[tauri::command]
fn tv_forget(w: tauri::State<'_, Tv>, id: Option<String>) -> Value {
    w.server.forget(id.as_deref());
    state(&w)
}
#[tauri::command]
fn tv_any_host(w: tauri::State<'_, Tv>, on: bool) -> Value {
    w.core.settings().set("anyHost", json!(on));
    state(&w)
}
#[tauri::command]
fn tv_fullscreen(window: tauri::WebviewWindow, w: tauri::State<'_, Tv>, on: bool) -> Value {
    w.core.settings().set("tvFullscreen", json!(on));
    let _ = window.set_fullscreen(on);
    state(&w)
}
// ───── Film we własnym oknie aplikacji (gdy nie ma przeglądarki z Widevine) ─────
// To przeglądarka wbudowana w aplikację (WebKitGTK): gra strony bez DRM (np. YouTube, część serwisów), logowanie działa.
// Netflix, Disney+ i podobne wymagają Widevine — do nich aplikacja instaluje Google Chrome (przycisk w „Ten komputer”).
static INAPP_SINCE: Mutex<Option<std::time::Instant>> = Mutex::new(None);
const INAPP_JS: &str = r#"
(function () {
  var close = function () { document.title = '__pitayas_close__' + Date.now(); };
  window.addEventListener('keydown', function (e) {
    var t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape' || e.key === 'BrowserBack' || e.key === 'XF86Back' || (e.key === 'Backspace' && !typing)) { e.preventDefault(); close(); }
  }, true);
})();
"#;

fn open_inapp(app: &AppHandle, url: String, title: String) -> Result<(), String> {
    if let Some(old) = app.get_webview_window("player") {
        let _ = old.close();
    }
    let parsed: tauri::Url = url.parse().map_err(|_| "Niepoprawny adres".to_string())?;
    tauri::WebviewWindowBuilder::new(app, "player", tauri::WebviewUrl::External(parsed))
        .title(if title.is_empty() { "Pitayas".to_string() } else { title })
        .fullscreen(true)
        .initialization_script(INAPP_JS)
        .on_document_title_changed(|win, t| {
            if t.starts_with("__pitayas_close__") {
                let _ = win.close();
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    *INAPP_SINCE.lock().unwrap() = Some(std::time::Instant::now());
    Ok(())
}

fn inapp_cmd(app: &AppHandle, action: &str, value: &Value) -> Result<(), String> {
    let Some(win) = app.get_webview_window("player") else { return Err("Nic nie jest otwarte".into()) };
    let n = value.as_f64().unwrap_or(0.0);
    let js = match action {
        "stop" => return win.close().map_err(|e| e.to_string()),
        "playpause" => "(function(v){if(v){v.paused?v.play():v.pause();}})(document.querySelector('video'))".to_string(),
        "play" => "(function(v){if(v)v.play();})(document.querySelector('video'))".to_string(),
        "pause" => "(function(v){if(v)v.pause();})(document.querySelector('video'))".to_string(),
        "seek" => format!("(function(v){{if(v)v.currentTime=Math.max(0,v.currentTime+({n}));}})(document.querySelector('video'))"),
        "seekto" => format!("(function(v){{if(v)v.currentTime={n};}})(document.querySelector('video'))"),
        "mute" => "(function(v){if(v)v.muted=!v.muted;})(document.querySelector('video'))".to_string(),
        "volume" => format!("(function(v){{if(v)v.volume=Math.min(1,Math.max(0,v.volume+({n})));}})(document.querySelector('video'))"),
        "fullscreen" => "(function(v){if(v){document.fullscreenElement?document.exitFullscreen():(v.requestFullscreen&&v.requestFullscreen());}})(document.querySelector('video'))".to_string(),
        "reload" => "location.reload()".to_string(),
        "key" if matches!(value.as_str(), Some("back") | Some("esc")) => return win.close().map_err(|e| e.to_string()),
        "scroll" => format!("window.scrollBy(0,{n})"),
        _ => return Err("To polecenie działa tylko z przeglądarką Chrome (zainstaluj ją w „Ten komputer”)".into()),
    };
    win.eval(&js).map_err(|e| e.to_string())
}

/// Film na tym komputerze: Chrome z Widevine, a gdy go nie ma — własne okno aplikacji
#[tauri::command]
async fn tv_open(app: AppHandle, w: tauri::State<'_, Tv>, url: String, title: String) -> Result<(), String> {
    services::check_url(&url, w.core.settings().get("anyHost") == Value::Bool(true))?;
    if player::drm_ready(w.core.settings()) {
        w.player.open(url, title).await
    } else {
        open_inapp(&app, url, title)
    }
}

/// Instalacja Google Chrome (potrzebny do Netflixa, Disney+ itd.): pobiera paczkę od Google i instaluje przez systemowe okno z hasłem (pkexec)
#[tauri::command]
async fn tv_install_chrome(w: tauri::State<'_, Tv>) -> Result<Value, String> {
    let dnf = pitayas_core::util::which("dnf").is_some();
    let apt = pitayas_core::util::which("apt").is_some();
    if !dnf && !apt {
        return Err("Instalacja automatyczna działa na Fedorze (dnf) i Debianie/Ubuntu (apt). Zainstaluj Google Chrome ręcznie.".into());
    }
    let (url, file) = if dnf {
        ("https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm", "pitayas-chrome.rpm")
    } else {
        ("https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb", "pitayas-chrome.deb")
    };
    let path = std::env::temp_dir().join(file);
    let bytes = reqwest::get(url).await.and_then(|r| r.error_for_status()).map_err(|e| format!("Nie udało się pobrać Chrome: {e}"))?.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    w.core.log().info("Instalacja Google Chrome (pkexec)");
    let out = if dnf {
        tokio::process::Command::new("pkexec").args(["dnf", "install", "-y"]).arg(&path).output().await
    } else {
        tokio::process::Command::new("pkexec").args(["apt", "install", "-y"]).arg(&path).output().await
    }
    .map_err(|e| format!("Nie mogę uruchomić instalatora: {e}"))?;
    let _ = std::fs::remove_file(&path);
    if !out.status.success() {
        return Err("Instalacja nie powiodła się albo została anulowana".into());
    }
    Ok(state(&w))
}
#[tauri::command]
async fn tv_stop(app: AppHandle, w: tauri::State<'_, Tv>) -> Result<Value, String> {
    if let Some(p) = app.get_webview_window("player") {
        let _ = p.close();
    }
    if w.player.is_open() {
        w.player.command("stop", Value::Null).await?;
    }
    Ok(state(&w))
}
#[tauri::command]
async fn tv_cmd(app: AppHandle, w: tauri::State<'_, Tv>, action: String, value: Option<Value>) -> Result<Value, String> {
    if app.get_webview_window("player").is_some() {
        inapp_cmd(&app, &action, &value.unwrap_or(Value::Null))?;
        return Ok(state(&w));
    }
    w.player.command(&action, value.unwrap_or(Value::Null)).await?;
    Ok(state(&w))
}

#[cfg(unix)]
async fn quit_on_signal(app: AppHandle) {
    use tokio::signal::unix::{signal, SignalKind};
    let (Ok(mut term), Ok(mut int)) = (signal(SignalKind::terminate()), signal(SignalKind::interrupt())) else { return };
    tokio::select! { _ = term.recv() => {}, _ = int.recv() => {} }
    app.state::<Core>().quit(&app);
}

async fn startup(app: AppHandle) {
    let w = app.state::<Tv>();
    let port = w.core.settings().get_u64("port", server::DEFAULT_PORT as u64) as u16;
    let _ = w.server.start(port).await;
    let (mut changes, mut playing) = (w.server.changes(), w.player.subscribe());
    let mut was_open: Option<std::time::Instant> = None;
    loop {
        let s = state(&w);
        let open = s["player"]["open"] == Value::Bool(true);
        // Zamknięcie filmu oddajemy modułowi Watch (jak „closed” z wtyczki w telefonie): czas z otwartym odtwarzaczem
        if open && was_open.is_none() {
            was_open = Some(std::time::Instant::now());
        } else if !open {
            if let Some(t) = was_open.take() {
                let _ = app.emit("pitayas-watch-closed", json!({ "seconds": t.elapsed().as_secs() }));
            }
        }
        w.core.set_status(json!({ "port": s["port"], "open": open, "title": s["player"]["title"], "devices": s["devices"].as_array().map(|d| d.len()) }));
        let _ = app.emit("tv:state", s);
        if let Some(a) = w.server.take_account() {
            let _ = app.emit("tv:account", a);
        }
        tokio::select! {
            r = changes.changed() => if r.is_err() { break },
            r = playing.changed() => if r.is_err() { break },
        }
    }
}

fn main() {
    let core = Core::create(Options {
        id: "desktop",
        folder: "Desktop",
        name: "Pitayas",
        repo: Some("Pitayas-Team/Pitayas-Mobile"),
        version: env!("CARGO_PKG_VERSION"),
        description: "Pitayas na komputer: aplikacja z modułami i tryb telewizora",
        defaults: json!({ "port": server::DEFAULT_PORT, "pin": "", "devices": [], "anyHost": false, "tvFullscreen": false, "browser": "", "browserArgs": "" }),
        icon: Some(include_bytes!("../icons/icon.png")),
        close_to_tray: false,
    });

    let runtime = tauri::async_runtime::handle();
    let _enter = runtime.inner().enter();
    let player = player::spawn(core.settings().clone(), core.log().clone(), core.paths().data.clone());
    let server = Server::new(core.settings().clone(), core.log().clone(), player.clone(), env!("CARGO_PKG_VERSION"));

    let p = player.clone();
    core.on_quit(move || {
        if p.is_open() {
            let p = p.clone();
            tauri::async_runtime::spawn(async move { p.command("stop", Value::Null).await });
            std::thread::sleep(std::time::Duration::from_millis(600));
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| Core::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .manage(core.clone())
        .manage(Tv { core: core.clone(), server, player })
        .invoke_handler(pitayas_core::handler![
            app_info, tv_state, tv_new_pin, tv_forget, tv_any_host, tv_fullscreen, tv_open, tv_stop, tv_cmd, tv_install_chrome,
            fs::fs_uri, fs::fs_write, fs::fs_mkdir, fs::fs_rmdir, fs::fs_delete, fs::fs_stat, fs::fs_rename, fs::fs_read, fs::fs_download
        ])
        .setup(|app| {
            let core = app.state::<Core>().inner().clone();
            core.start(app.handle());
            for d in [app.path().app_data_dir(), app.path().app_cache_dir()].into_iter().flatten() {
                let _ = std::fs::create_dir_all(d);
            }
            // Telefon wysyła film, a nie ma Chrome: gra we własnym oknie aplikacji
            let (a1, a2) = (app.handle().clone(), app.handle().clone());
            app.state::<Tv>().server.set_fallback(server::Fallback {
                open: Arc::new(move |url, title| open_inapp(&a1, url, title)),
                cmd: Arc::new(move |action, value| inapp_cmd(&a2, action, value)),
            });
            tauri::async_runtime::spawn(startup(app.handle().clone()));
            #[cfg(unix)]
            tauri::async_runtime::spawn(quit_on_signal(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|w, e| {
            // Zamknięcie okna z filmem: oddajemy modułowi czas oglądania (jak „closed” z wtyczki w telefonie)
            if let tauri::WindowEvent::Destroyed = e {
                if w.label() == "player" {
                    if let Some(t) = INAPP_SINCE.lock().unwrap().take() {
                        let _ = w.app_handle().emit("pitayas-watch-closed", json!({ "seconds": t.elapsed().as_secs() }));
                    }
                    if let Some(m) = w.app_handle().get_webview_window("main") {
                        let _ = m.set_focus();
                    }
                }
            }
            if w.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                w.app_handle().state::<Core>().quit(w.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("Pitayas nie wystartował");
}
