// ═══════ PITAYAS — APLIKACJA NA TELEFON (Tauri 2) ═══════
// Powłoka w Rust: okno z tym samym rdzeniem i modułami co dotąd (../www, aktualizowane OTA).
// Rdzeń pisany był dla Capacitora — www/tauri-shim.js podstawia window.Capacitor, a pod spodem woła polecenia z tego pliku:
//   pliki (pobrany rdzeń i moduły, pobieranie z postępem), przekaźnik USB dla iPhone'a (Screen po kablu), informacje o aplikacji.
// Powiadomienia i otwieranie linków — oficjalne wtyczki Tauri (notification, opener).
mod fs;
mod usb;

use serde_json::{json, Value};
use tauri::Manager;

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> Value {
    let p = app.package_info();
    json!({ "name": p.name, "id": app.config().identifier, "version": p.version.to_string(), "build": p.version.to_string(), "platform": std::env::consts::OS })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(usb::Relay::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            fs::fs_uri,
            fs::fs_write,
            fs::fs_mkdir,
            fs::fs_rmdir,
            fs::fs_delete,
            fs::fs_stat,
            fs::fs_rename,
            fs::fs_read,
            fs::fs_download,
            usb::usb_start,
            usb::usb_stop
        ])
        .setup(|app| {
            // Foldery danych od razu (pobrany rdzeń i moduły trafiają do DATA)
            for d in [app.path().app_data_dir(), app.path().app_cache_dir()].into_iter().flatten() {
                let _ = std::fs::create_dir_all(d);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Pitayas nie wystartował");
}
