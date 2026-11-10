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
use tauri::{AppHandle, Emitter, Manager};

struct Tv {
    core: Core,
    server: Server,
    player: PlayerHandle,
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
/// Film na tym komputerze (przeglądarka z Widevine) — ten sam odtwarzacz, który obsługuje telefony
#[tauri::command]
async fn tv_open(w: tauri::State<'_, Tv>, url: String, title: String) -> Result<(), String> {
    services::check_url(&url, w.core.settings().get("anyHost") == Value::Bool(true))?;
    w.player.open(url, title).await
}
#[tauri::command]
async fn tv_stop(w: tauri::State<'_, Tv>) -> Result<Value, String> {
    w.player.command("stop", Value::Null).await?;
    Ok(state(&w))
}
#[tauri::command]
async fn tv_cmd(w: tauri::State<'_, Tv>, action: String, value: Option<Value>) -> Result<Value, String> {
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
            app_info, tv_state, tv_new_pin, tv_forget, tv_any_host, tv_fullscreen, tv_open, tv_stop, tv_cmd,
            fs::fs_uri, fs::fs_write, fs::fs_mkdir, fs::fs_rmdir, fs::fs_delete, fs::fs_stat, fs::fs_rename, fs::fs_read, fs::fs_download
        ])
        .setup(|app| {
            let core = app.state::<Core>().inner().clone();
            core.start(app.handle());
            for d in [app.path().app_data_dir(), app.path().app_cache_dir()].into_iter().flatten() {
                let _ = std::fs::create_dir_all(d);
            }
            tauri::async_runtime::spawn(startup(app.handle().clone()));
            #[cfg(unix)]
            tauri::async_runtime::spawn(quit_on_signal(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                w.app_handle().state::<Core>().quit(w.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("Pitayas nie wystartował");
}
