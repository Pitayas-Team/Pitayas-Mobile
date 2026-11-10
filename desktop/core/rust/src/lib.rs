// ═══════ PITAYA CORE (Rust) ═══════
// Wspólny rdzeń aplikacji Pitayas w Rust — ten sam kontrakt co wersja JS (Core 0.2):
//
//   ~/.config/Pitayas/              (Windows: %APPDATA%\Pitayas, macOS: ~/Library/Application Support/Pitayas)
//     apps/<id>.json                wpis aplikacji: nazwa, wersja, jak ją uruchomić, ikona (registry)
//     run/<id>.json, run/<id>.sock  gdy działa: pid, status i gniazdo sterowania (control)
//     <Folder>/settings.json        ustawienia aplikacji
//     <Folder>/data/                dane aplikacji
//     <Folder>/logs/app.log         dziennik (z rotacją)
//
// Użycie w aplikacji Tauri (src-tauri/src/main.rs):
//   let core = pitayas_core::Core::create(Options { id: "screen", folder: "Screen", name: "Pitayas Screen", … })?;
//   tauri::Builder::default().manage(core.clone()).invoke_handler(pitayas_core::handler![moje_polecenia…])
// W oknie: <script src="core/ui/tauri-bridge.js"> tworzy window.pitayaBridge (jak core/bridge.js w Electronie).
pub mod control;
pub mod log;
pub mod registry;
pub mod settings;
pub mod updater;
pub mod util;
#[cfg(feature = "tauri")]
pub mod app;

pub use log::Logger;
pub use settings::Settings;
pub use updater::compare_versions;
pub use util::{read_json, root_dir, write_json};

pub const CORE_VERSION: &str = "0.3.0";

#[cfg(feature = "tauri")]
pub use app::{Core, Options};
