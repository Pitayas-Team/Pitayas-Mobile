// Aktualizacje z GitHuba — tak jak updater.js:
//  • AppImage          → pobranie nowego AppImage z najnowszego wydania i podmiana pliku
//  • pakiet RPM / DEB  → pobranie pakietu i instalacja przez pkexec (systemowe okno z hasłem)
//  • Windows (NSIS)    → pobranie instalatora; po „Uruchom ponownie” instaluje się po cichu i uruchamia aplikację
//  • inne              → otwarcie strony wydania w przeglądarce
// Pliki wybieramy po rozszerzeniu, więc aplikacje w Electronie przechodzą na wersje w Rust same.
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

const UA: &str = "Pitayas-Updater";

fn parse(v: &str) -> (Vec<u64>, Vec<String>) {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, p),
        None => (v, ""),
    };
    let nums = core.split('.').map(|n| n.parse().unwrap_or(0)).collect();
    let pre = if pre.is_empty() { vec![] } else { pre.split('.').map(String::from).collect() };
    (nums, pre)
}

/// Porównanie jak semver: 0.1.0 > 0.1.0-beta.2 > 0.1.0-beta > 0.0.9
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let (na, pa) = parse(a);
    let (nb, pb) = parse(b);
    for i in 0..na.len().max(nb.len()) {
        let o = na.get(i).unwrap_or(&0).cmp(nb.get(i).unwrap_or(&0));
        if o != Ordering::Equal {
            return o;
        }
    }
    // Wersja bez dopisku (stabilna) jest nowsza niż ta sama z dopiskiem (beta)
    match (pa.is_empty(), pb.is_empty()) {
        (true, true) => return Ordering::Equal,
        (true, false) => return Ordering::Greater,
        (false, true) => return Ordering::Less,
        _ => {}
    }
    for i in 0..pa.len().max(pb.len()) {
        match (pa.get(i), pb.get(i)) {
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(x), Some(y)) => {
                let (nx, ny) = (x.parse::<u64>(), y.parse::<u64>());
                let o = match (nx, ny) {
                    (Ok(a), Ok(b)) => a.cmp(&b),
                    (Ok(_), Err(_)) => Ordering::Less,
                    (Err(_), Ok(_)) => Ordering::Greater,
                    _ => x.cmp(y),
                };
                if o != Ordering::Equal {
                    return o;
                }
            }
        }
    }
    Ordering::Equal
}

fn get_json(url: &str) -> Result<Value, String> {
    let r = ureq::get(url).set("User-Agent", UA).set("Accept", "application/vnd.github+json").call();
    match r {
        Ok(resp) => resp.into_json().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(404, _)) => Ok(Value::Null),
        Err(ureq::Error::Status(code, _)) => Err(format!("GitHub HTTP {code}")),
        Err(e) => Err(e.to_string()),
    }
}

/// /releases/latest pomija wydania testowe, więc bierzemy listę i najwyższą wersję
fn newest_release(repo: &str) -> Result<Option<Value>, String> {
    let list = get_json(&format!("https://api.github.com/repos/{repo}/releases?per_page=30"))?;
    let mut rel: Vec<Value> = list.as_array().cloned().unwrap_or_default().into_iter().filter(|r| r["draft"] != true).collect();
    rel.sort_by(|x, y| compare_versions(tag(y), tag(x)));
    Ok(rel.into_iter().next())
}

fn tag(r: &Value) -> &str {
    r["tag_name"].as_str().or(r["name"].as_str()).unwrap_or("")
}

fn download(url: &str, dest: &PathBuf, progress: &dyn Fn(Value)) -> Result<(), String> {
    let resp = ureq::get(url).set("User-Agent", UA).call().map_err(|e| format!("Pobieranie nie powiodło się: {e}"))?;
    let total: u64 = resp.header("content-length").and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut out = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let (mut got, mut last) = (0u64, -1i64);
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        let pct = if total > 0 { (got * 100 / total) as i64 } else { 0 };
        if pct != last {
            last = pct;
            progress(json!({ "stage": "download", "percent": pct, "bytes": got, "total": total }));
        }
    }
    Ok(())
}

/// Jak zainstalowano aplikację: appimage | rpm | deb | nsis | dev | other
pub fn install_kind() -> &'static str {
    static KIND: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();
    KIND.get_or_init(|| {
        if cfg!(debug_assertions) {
            return "dev";
        }
        if std::env::var("APPIMAGE").map(|s| !s.is_empty()).unwrap_or(false) {
            return "appimage";
        }
        let exe = std::env::current_exe().unwrap_or_default();
        if cfg!(windows) {
            // Instalator NSIS (Tauri) zostawia uninstall.exe obok programu
            let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default();
            return if dir.join("uninstall.exe").exists() { "nsis" } else { "other" };
        }
        let owns = |cmd: &str, args: &[&str]| {
            crate::util::which(cmd).is_some()
                && std::process::Command::new(cmd).args(args).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).status().map(|s| s.success()).unwrap_or(false)
        };
        let e = exe.to_string_lossy().to_string();
        if owns("rpm", &["-qf", &e]) {
            "rpm"
        } else if owns("dpkg", &["-S", &e]) {
            "deb"
        } else {
            "other"
        }
    })
}

fn pick_asset(release: &Value) -> Option<Value> {
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let name = |a: &Value| a["name"].as_str().unwrap_or("").to_lowercase();
    let find = |f: &dyn Fn(&str) -> bool| assets.iter().find(|a| f(&name(a))).cloned();
    match install_kind() {
        "appimage" => find(&|n| n.ends_with(".appimage")),
        "nsis" => find(&|n| n.ends_with(".exe") && n.contains("setup")).or_else(|| find(&|n| n.ends_with(".exe") && !n.contains("portable"))),
        "rpm" => find(&|n| n.ends_with(".rpm") && (n.contains("x86_64") || n.contains("amd64") || n.contains("noarch"))),
        "deb" => find(&|n| n.ends_with(".deb")),
        _ => None,
    }
}

fn install_package(kind: &str, file: &PathBuf) -> Result<(), String> {
    let pkexec = crate::util::which("pkexec").ok_or("Brak programu pkexec — zainstaluj pobrany pakiet ręcznie.")?;
    let f = file.to_string_lossy().to_string();
    let cmd: Vec<String> = if kind == "rpm" {
        match crate::util::which("dnf").or_else(|| crate::util::which("dnf5")).or_else(|| crate::util::which("yum")) {
            Some(d) => vec![d.to_string_lossy().into(), "install".into(), "-y".into(), f],
            None => vec!["rpm".into(), "-U".into(), "--replacepkgs".into(), f],
        }
    } else {
        match crate::util::which("apt-get") {
            Some(a) => vec![a.to_string_lossy().into(), "install".into(), "-y".into(), f],
            None => vec!["dpkg".into(), "-i".into(), f],
        }
    };
    let out = std::process::Command::new(pkexec).args(&cmd).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    let code = out.status.code().unwrap_or(1);
    if code == 126 || code == 127 {
        return Err("Instalacja anulowana — nie podano hasła administratora.".into());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(format!("Instalacja pakietu nie powiodła się: {}", err.lines().rev().take(3).collect::<Vec<_>>().join(" ")))
}

#[derive(Clone)]
pub struct Updater {
    pub repo: String,
    pub current: String,
    last: Arc<Mutex<Option<Value>>>,
    pending: Arc<Mutex<Option<PathBuf>>>,
}

impl Updater {
    pub fn new(repo: &str, current: &str) -> Self {
        Updater { repo: repo.into(), current: current.into(), last: Arc::default(), pending: Arc::default() }
    }
    pub fn repo_url(&self) -> String {
        format!("https://github.com/{}", self.repo)
    }

    pub fn check(&self) -> Value {
        let current = &self.current;
        match newest_release(&self.repo) {
            Err(e) => json!({ "ok": false, "currentVersion": current, "error": e }),
            Ok(None) => json!({ "ok": true, "mode": "release", "currentVersion": current, "hasUpdate": false, "latestVersion": null }),
            Ok(Some(r)) => {
                let latest = tag(&r).trim_start_matches(['v', 'V']).to_string();
                let asset = pick_asset(&r);
                let kind = install_kind();
                let has = !latest.is_empty() && compare_versions(&latest, current) == Ordering::Greater;
                let out = json!({
                    "ok": true, "mode": "release", "currentVersion": current, "latestVersion": latest,
                    "notes": r["body"].as_str().unwrap_or(""), "url": r["html_url"], "prerelease": r["prerelease"] == true,
                    "installKind": kind, "canAutoInstall": asset.is_some() && ["appimage", "rpm", "deb", "nsis"].contains(&kind),
                    "hasUpdate": has,
                });
                *self.last.lock().unwrap() = Some(r);
                out
            }
        }
    }

    /// Zwraca {ok, restart} albo {ok, openedBrowser}; „open” otwiera stronę wydania, gdy nie da się zainstalować samemu
    pub fn apply(&self, progress: &dyn Fn(Value), open: &dyn Fn(&str)) -> Value {
        let work = || -> Result<Value, String> {
            let release = match self.last.lock().unwrap().clone() {
                Some(r) => r,
                None => newest_release(&self.repo)?.ok_or("Brak opublikowanych wersji na GitHubie")?,
            };
            let kind = install_kind();
            let asset = pick_asset(&release);
            let url = asset.as_ref().and_then(|a| a["browser_download_url"].as_str().map(String::from));
            let name = asset.as_ref().and_then(|a| a["name"].as_str().map(String::from)).unwrap_or_default();
            match (kind, url) {
                ("appimage", Some(url)) => {
                    let target = PathBuf::from(std::env::var("APPIMAGE").unwrap_or_default());
                    let tmp = PathBuf::from(format!("{}.download", target.display()));
                    download(&url, &tmp, progress)?;
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::PermissionsExt;
                        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
                    }
                    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
                    Ok(json!({ "ok": true, "restart": true }))
                }
                ("rpm" | "deb", Some(url)) => {
                    let file = std::env::temp_dir().join(&name);
                    download(&url, &file, progress)?;
                    progress(json!({ "stage": "install" }));
                    let r = install_package(kind, &file);
                    let _ = std::fs::remove_file(&file);
                    r?;
                    Ok(json!({ "ok": true, "restart": true }))
                }
                ("nsis", Some(url)) => {
                    let file = std::env::temp_dir().join(&name);
                    download(&url, &file, progress)?;
                    *self.pending.lock().unwrap() = Some(file);
                    Ok(json!({ "ok": true, "restart": true }))
                }
                _ => {
                    open(release["html_url"].as_str().unwrap_or(&self.repo_url()));
                    Ok(json!({ "ok": true, "openedBrowser": true }))
                }
            }
        };
        work().unwrap_or_else(|e| json!({ "ok": false, "error": e }))
    }

    /// Uruchomienie nowej wersji. Zwraca true, gdy aplikacja ma się teraz zamknąć.
    pub fn restart(&self) -> bool {
        let exe = std::env::current_exe().unwrap_or_default();
        if let Some(setup) = self.pending.lock().unwrap().take() {
            // Windows: cicha instalacja, potem start programu z tego samego miejsca
            let script = format!("start /wait \"\" \"{}\" /S & start \"\" \"{}\"", setup.display(), exe.display());
            let mut c = std::process::Command::new("cmd.exe");
            c.args(["/d", "/c", &script]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.creation_flags(0x0800_0000);
            }
            let _ = c.spawn();
            return true;
        }
        // AppImage montuje się w /tmp — uruchamiamy sam plik AppImage, a nie binarkę z montowania
        let target = std::env::var("APPIMAGE").ok().filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or(exe);
        std::process::Command::new(target).spawn().is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions() {
        assert_eq!(compare_versions("0.1.0", "0.1.0-beta"), Ordering::Greater);
        assert_eq!(compare_versions("0.1.0-beta.2", "0.1.0-beta"), Ordering::Greater);
        assert_eq!(compare_versions("0.2.0-beta", "0.1.5-beta"), Ordering::Greater);
        assert_eq!(compare_versions("v0.1.5-beta", "0.1.5-beta"), Ordering::Equal);
        assert_eq!(compare_versions("0.0.9", "0.1.0-beta"), Ordering::Less);
        assert_eq!(compare_versions("0.1.0-beta", "0.1.0-alpha"), Ordering::Greater);
    }
}
