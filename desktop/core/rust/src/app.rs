// Pitaya Core dla aplikacji Tauri: folder danych, ustawienia, logi, rejestr, kanał sterowania, aktualizacje
// i polecenia dla window.pitayaBridge (core/ui/tauri-bridge.js).
use crate::control::{Handler, Handlers};
use crate::registry::{self, Running};
use crate::updater::Updater;
use crate::{Logger, Settings, CORE_VERSION};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

pub struct Options {
    pub id: &'static str,
    pub folder: &'static str,
    pub name: &'static str,
    /// np. "Pitayas-Team/Pitayas-Screen" — aktualizacje z wydań na GitHubie
    pub repo: Option<&'static str>,
    pub version: &'static str,
    pub description: &'static str,
    pub defaults: Value,
    /// Ikona dla huba (kopiowana do folderu danych)
    pub icon: Option<&'static [u8]>,
    /// Zamknięcie okna chowa je do zasobnika (true) albo kończy aplikację (false)
    pub close_to_tray: bool,
}

pub struct Paths {
    pub root: PathBuf,
    pub dir: PathBuf,
    pub data: PathBuf,
    pub logs: PathBuf,
    pub cache: PathBuf,
    pub settings: PathBuf,
}

struct Inner {
    id: String,
    name: String,
    folder: String,
    version: String,
    description: String,
    paths: Paths,
    settings: Settings,
    log: Logger,
    updater: Option<Updater>,
    handlers: Handlers,
    running: Mutex<Option<Running>>,
    first_run: bool,
    icon: Option<&'static [u8]>,
    close_to_tray: bool,
    before_quit: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
}

#[derive(Clone)]
pub struct Core(Arc<Inner>);

impl Core {
    pub fn create(o: Options) -> Core {
        // Linux + NVIDIA: WebKitGTK z rendererem DMA-BUF potrafi pokazać puste/czarne okno — wyłączamy go (chyba że ktoś ustawił sam)
        #[cfg(target_os = "linux")]
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && std::path::Path::new("/proc/driver/nvidia").exists() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        let root = crate::root_dir();
        let dir = root.join(o.folder);
        let paths = Paths { data: dir.join("data"), logs: dir.join("logs"), cache: dir.join("cache"), settings: dir.join("settings.json"), root, dir };
        let first_run = !paths.dir.exists();
        for p in [&paths.data, &paths.logs, &paths.cache] {
            let _ = std::fs::create_dir_all(p);
        }
        let log = Logger::new(&paths.logs, o.name);
        let settings = Settings::load(paths.settings.clone(), o.defaults);
        let core = Core(Arc::new(Inner {
            id: o.id.into(),
            name: o.name.into(),
            folder: o.folder.into(),
            version: o.version.into(),
            description: o.description.into(),
            updater: o.repo.map(|r| Updater::new(r, o.version)),
            handlers: Arc::default(),
            running: Mutex::new(None),
            first_run,
            icon: o.icon,
            close_to_tray: o.close_to_tray,
            before_quit: Mutex::new(None),
            paths,
            settings,
            log,
        }));
        let l = core.0.log.clone();
        std::panic::set_hook(Box::new(move |info| l.error(format!("Błąd programu: {info}"))));
        core
    }

    pub fn id(&self) -> &str {
        &self.0.id
    }
    pub fn name(&self) -> &str {
        &self.0.name
    }
    pub fn version(&self) -> &str {
        &self.0.version
    }
    pub fn paths(&self) -> &Paths {
        &self.0.paths
    }
    pub fn settings(&self) -> &Settings {
        &self.0.settings
    }
    pub fn log(&self) -> &Logger {
        &self.0.log
    }
    pub fn updater(&self) -> Option<&Updater> {
        self.0.updater.as_ref()
    }

    /// Własne polecenie kanału sterowania (dla huba i innych aplikacji)
    pub fn handle(&self, cmd: &str, f: impl Fn(Value) -> Result<Value, String> + Send + Sync + 'static) {
        self.0.handlers.write().unwrap().insert(cmd.into(), Arc::new(f) as Handler);
    }
    /// Status widoczny dla huba (run/<id>.json)
    pub fn set_status(&self, patch: Value) {
        if let Some(r) = self.0.running.lock().unwrap().as_ref() {
            r.update_status(patch);
        }
    }
    /// Sprzątanie przed wyjściem (zatrzymanie procesów, zamknięcie sesji)
    pub fn on_quit(&self, f: impl Fn() + Send + Sync + 'static) {
        *self.0.before_quit.lock().unwrap() = Some(Arc::new(f));
    }

    /// Wyjście z aplikacji: sprzątanie, plik „działam”, koniec procesu
    pub fn quit<R: Runtime>(&self, app: &AppHandle<R>) {
        if let Some(f) = self.0.before_quit.lock().unwrap().clone() {
            f();
        }
        if let Some(r) = self.0.running.lock().unwrap().take() {
            r.clear();
        }
        #[cfg(unix)]
        let _ = std::fs::remove_file(crate::control::socket_path(&registry::dirs(&self.0.paths.root).run, &self.0.id));
        app.exit(0);
    }

    pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }

    /// Wywołać w setup(): rejestr, kanał sterowania, wpis w dzienniku
    pub fn start<R: Runtime>(&self, app: &AppHandle<R>) {
        let i = &self.0;
        let exe = std::env::current_exe().unwrap_or_default();
        let appimage = std::env::var("APPIMAGE").ok().filter(|s| !s.is_empty());
        let executable = appimage.clone().unwrap_or_else(|| exe.to_string_lossy().into());
        let icon = i.icon.and_then(|b| {
            let p = i.paths.dir.join("icon.png");
            std::fs::write(&p, b).ok().map(|_| p.to_string_lossy().to_string())
        });
        registry::register(
            json!({
                "id": i.id, "name": i.name, "folder": i.folder, "kind": "tauri",
                "description": i.description, "version": i.version, "coreVersion": CORE_VERSION,
                "executable": executable, "packaged": !cfg!(debug_assertions),
                "launch": { "command": executable, "args": [] }, "icon": icon,
                "repo": i.updater.as_ref().map(|u| u.repo.clone()), "dataDir": i.paths.dir,
                "platform": std::env::consts::OS,
            }),
            &i.paths.root,
        );

        // Wbudowane polecenia: ping, info, status, show, quit
        let (id, name, ver, dir) = (i.id.clone(), i.name.clone(), i.version.clone(), i.paths.dir.clone());
        self.handle("ping", {
            let id = id.clone();
            move |_| Ok(json!({ "id": id, "pong": true }))
        });
        let hs = i.handlers.clone();
        self.handle("info", move |_| {
            let cmds: Vec<String> = hs.read().unwrap().keys().cloned().collect();
            Ok(json!({ "id": id, "name": name, "version": ver, "coreVersion": CORE_VERSION, "pid": std::process::id(), "dataDir": dir, "commands": cmds }))
        });
        let me = self.clone();
        self.handle("status", move |_| Ok(me.0.running.lock().unwrap().as_ref().map(|r| r.status()).unwrap_or(json!({}))));
        let a = app.clone();
        self.handle("show", move |_| {
            let a2 = a.clone();
            let _ = a.run_on_main_thread(move || Core::show_main(&a2));
            Ok(json!(true))
        });
        let (a, me) = (app.clone(), self.clone());
        self.handle("quit", move |_| {
            let (a2, me2) = (a.clone(), me.clone());
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(50));
                me2.quit(&a2);
            });
            Ok(json!(true))
        });

        let d = registry::dirs(&i.paths.root);
        let _ = std::fs::create_dir_all(&d.run);
        *i.running.lock().unwrap() = Some(registry::mark_running(&i.id, json!({ "name": i.name, "version": i.version, "coreVersion": CORE_VERSION }), &i.paths.root));
        let (sock, hs, log) = (crate::control::socket_path(&d.run, &i.id), i.handlers.clone(), i.log.clone());
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::control::serve(sock, hs).await {
                log.warn(format!("Kanał sterowania nie wystartował: {e}"));
            }
        });
        i.log.info(format!("Start {} {} (Core {}){}", i.name, i.version, CORE_VERSION, if i.first_run { " — pierwsze uruchomienie" } else { "" }));
    }
}

/// Otwarcie folderu albo adresu w systemie
pub fn open_in_system(target: &str) {
    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(target).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(target).spawn();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer.exe").arg(target).creation_flags(0x0800_0000).spawn();
    }
}

// ───── Polecenia dla window.pitayaBridge ─────
#[tauri::command]
pub fn pitaya_app_info(core: tauri::State<'_, Core>) -> Value {
    let i = &core.0;
    json!({ "id": i.id, "name": i.name, "version": i.version, "repoUrl": i.updater.as_ref().map(|u| u.repo_url()), "dataDir": i.paths.dir, "coreVersion": CORE_VERSION })
}
#[tauri::command]
pub fn pitaya_settings_get(core: tauri::State<'_, Core>) -> Value {
    core.0.settings.all()
}
#[tauri::command]
pub fn pitaya_settings_set(core: tauri::State<'_, Core>, patch: Value) -> Value {
    core.0.settings.merge(patch)
}
#[tauri::command]
pub fn pitaya_open_data_dir(core: tauri::State<'_, Core>) {
    open_in_system(&core.0.paths.dir.to_string_lossy());
}
#[tauri::command]
pub fn pitaya_open_external(url: String) {
    if url.starts_with("https://github.com/") {
        open_in_system(&url);
    }
}
#[tauri::command]
pub async fn pitaya_update_check(core: tauri::State<'_, Core>) -> Result<Value, String> {
    let u = core.0.updater.clone().ok_or("Brak aktualizacji dla tej aplikacji")?;
    tauri::async_runtime::spawn_blocking(move || u.check()).await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn pitaya_update_apply<R: Runtime>(window: WebviewWindow<R>, core: tauri::State<'_, Core>) -> Result<Value, String> {
    let u = core.0.updater.clone().ok_or("Brak aktualizacji dla tej aplikacji")?;
    tauri::async_runtime::spawn_blocking(move || {
        let w = window.clone();
        u.apply(&move |p| { let _ = w.emit("pitaya:update-progress", p); }, &|url| open_in_system(url))
    })
    .await
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn pitaya_update_restart<R: Runtime>(app: AppHandle<R>, core: tauri::State<'_, Core>) {
    if let Some(u) = core.0.updater.as_ref() {
        if u.restart() {
            core.quit(&app);
        }
    }
}
#[tauri::command]
pub fn pitaya_win_minimize<R: Runtime>(window: WebviewWindow<R>) {
    let _ = window.minimize();
}
#[tauri::command]
pub fn pitaya_win_close<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, core: tauri::State<'_, Core>) {
    if core.0.close_to_tray {
        let _ = window.hide();
    } else {
        core.quit(&app);
    }
}
#[tauri::command]
pub fn pitaya_quit<R: Runtime>(app: AppHandle<R>, core: tauri::State<'_, Core>) {
    core.quit(&app);
}

/// tauri::generate_handler! z poleceniami rdzenia i aplikacji:  .invoke_handler(pitayas_core::handler![moje::polecenie])
#[macro_export]
macro_rules! handler {
    ($($cmd:path),* $(,)?) => {
        ::tauri::generate_handler![
            $crate::app::pitaya_app_info, $crate::app::pitaya_settings_get, $crate::app::pitaya_settings_set,
            $crate::app::pitaya_open_data_dir, $crate::app::pitaya_open_external, $crate::app::pitaya_update_check,
            $crate::app::pitaya_update_apply, $crate::app::pitaya_update_restart, $crate::app::pitaya_win_minimize,
            $crate::app::pitaya_win_close, $crate::app::pitaya_quit,
            $($cmd),*
        ]
    };
}
