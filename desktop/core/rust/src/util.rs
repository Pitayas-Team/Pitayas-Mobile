// Ścieżki i zapis JSON — wspólne dla całego rdzenia
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

/// ~/.config/Pitayas (Windows: %APPDATA%\Pitayas). PITAYAS_HOME nadpisuje (kontenery, testy).
pub fn root_dir() -> PathBuf {
    if let Ok(p) = std::env::var("PITAYAS_HOME") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    let home = home_dir();
    if cfg!(windows) {
        let appdata = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| home.join("AppData").join("Roaming"));
        return appdata.join("Pitayas");
    }
    if cfg!(target_os = "macos") {
        return home.join("Library").join("Application Support").join("Pitayas");
    }
    let config = std::env::var("XDG_CONFIG_HOME").ok().filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
    config.join("Pitayas")
}

pub fn home_dir() -> PathBuf {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var(var).map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
}

pub fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(file).ok()?).ok()
}

/// Zapis przez plik tymczasowy, żeby przerwany zapis nie zostawił uszkodzonego JSON-a
pub fn write_json(file: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension(format!("json.{}.tmp", std::process::id()));
    fs::write(&tmp, serde_json::to_string_pretty(value).unwrap_or_default())?;
    fs::rename(&tmp, file)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Pierwszy plik o tej nazwie w PATH (i typowych katalogach systemowych)
pub fn which(cmd: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    if !cfg!(windows) {
        dirs.extend(["/usr/bin", "/usr/sbin", "/bin"].iter().map(PathBuf::from));
    }
    let names: Vec<String> = if cfg!(windows) { vec![format!("{cmd}.exe"), cmd.to_string()] } else { vec![cmd.to_string()] };
    for d in dirs {
        for n in &names {
            let p = d.join(n);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Czy proces o tym pid żyje
pub fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        // kill -0 przez /proc (Linux) albo polecenie kill (macOS)
        if Path::new("/proc").is_dir() {
            return Path::new(&format!("/proc/{pid}")).exists();
        }
        return std::process::Command::new("kill").args(["-0", &pid.to_string()]).status().map(|s| s.success()).unwrap_or(false);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .creation_flags(0x0800_0000)
            .output();
        return out.map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string())).unwrap_or(false);
    }
    #[allow(unreachable_code)]
    false
}
