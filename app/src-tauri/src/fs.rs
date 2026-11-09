// Pliki dla rdzenia i modułów — odpowiednik @capacitor/filesystem (tylko używane metody).
// Foldery: DATA (dane aplikacji: pobrany rdzeń i moduły), CACHE, DOCUMENTS (pobrane filmy i muzyka).
use base64::Engine;
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

type Res<T> = Result<T, String>;

fn base(app: &AppHandle, directory: &str) -> Res<PathBuf> {
    let p = app.path();
    let dir = match directory {
        "CACHE" => p.app_cache_dir(),
        "DOCUMENTS" => p.document_dir().map(|d| d.join("Pitayas")),
        "EXTERNAL" | "EXTERNAL_STORAGE" => p.download_dir().map(|d| d.join("Pitayas")),
        _ => p.app_data_dir(),
    }
    .map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Ścieżka wewnątrz wybranego folderu (bez wychodzenia poza niego przez „..”)
fn resolve(app: &AppHandle, directory: &str, path: &str) -> Res<PathBuf> {
    let rel = Path::new(path.trim_start_matches('/'));
    if rel.components().any(|c| matches!(c, Component::ParentDir | Component::Prefix(_))) {
        return Err("Niedozwolona ścieżka".into());
    }
    Ok(base(app, directory)?.join(rel))
}

#[tauri::command]
pub fn fs_uri(app: AppHandle, directory: String, path: String) -> Res<Value> {
    let p = resolve(&app, &directory, &path)?;
    Ok(json!({ "uri": p.to_string_lossy() }))
}

#[tauri::command]
pub async fn fs_write(app: AppHandle, directory: String, path: String, data: String, recursive: bool, append: bool, encoding: Option<String>) -> Res<Value> {
    let p = resolve(&app, &directory, &path)?;
    if recursive || append {
        if let Some(parent) = p.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
    }
    // Bez kodowania: dane w base64 (jak w Capacitorze); z kodowaniem utf8: zwykły tekst
    let bytes = if encoding.as_deref().map(|e| e.to_lowercase().starts_with("utf")).unwrap_or(false) {
        data.into_bytes()
    } else {
        base64::engine::general_purpose::STANDARD.decode(data.trim()).map_err(|e| format!("Niepoprawne dane: {e}"))?
    };
    let mut f = tokio::fs::OpenOptions::new().create(true).write(true).append(append).truncate(!append).open(&p).await.map_err(|e| e.to_string())?;
    f.write_all(&bytes).await.map_err(|e| e.to_string())?;
    Ok(json!({ "uri": p.to_string_lossy() }))
}

#[tauri::command]
pub async fn fs_read(app: AppHandle, directory: String, path: String) -> Res<Value> {
    let p = resolve(&app, &directory, &path)?;
    let b = tokio::fs::read(&p).await.map_err(|e| e.to_string())?;
    Ok(json!({ "data": base64::engine::general_purpose::STANDARD.encode(b) }))
}

#[tauri::command]
pub async fn fs_mkdir(app: AppHandle, directory: String, path: String) -> Res<()> {
    tokio::fs::create_dir_all(resolve(&app, &directory, &path)?).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_rmdir(app: AppHandle, directory: String, path: String, recursive: bool) -> Res<()> {
    let p = resolve(&app, &directory, &path)?;
    if recursive { tokio::fs::remove_dir_all(&p).await } else { tokio::fs::remove_dir(&p).await }.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_delete(app: AppHandle, directory: String, path: String) -> Res<()> {
    tokio::fs::remove_file(resolve(&app, &directory, &path)?).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_stat(app: AppHandle, directory: String, path: String) -> Res<Value> {
    let p = resolve(&app, &directory, &path)?;
    let m = tokio::fs::metadata(&p).await.map_err(|e| e.to_string())?;
    let mtime = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    Ok(json!({ "type": if m.is_dir() { "directory" } else { "file" }, "size": m.len(), "mtime": mtime, "uri": p.to_string_lossy() }))
}

#[tauri::command]
pub async fn fs_rename(app: AppHandle, directory: String, from: String, to: String) -> Res<()> {
    let (a, b) = (resolve(&app, &directory, &from)?, resolve(&app, &directory, &to)?);
    tokio::fs::rename(a, b).await.map_err(|e| e.to_string())
}

/// Pobieranie pliku prosto na dysk (filmy, muzyka) — postęp zdarzeniem „fs-progress” { url, bytes, contentLength }
#[tauri::command]
pub async fn fs_download(app: AppHandle, url: String, directory: String, path: String, progress: bool) -> Res<Value> {
    let p = resolve(&app, &directory, &path)?;
    if let Some(parent) = p.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    let res = reqwest::Client::new().get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut out = tokio::fs::File::create(&p).await.map_err(|e| e.to_string())?;
    let mut got: u64 = 0;
    let mut last = std::time::Instant::now();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if progress && last.elapsed().as_millis() >= 250 {
            last = std::time::Instant::now();
            let _ = app.emit("fs-progress", json!({ "url": url, "bytes": got, "contentLength": total }));
        }
    }
    out.flush().await.map_err(|e| e.to_string())?;
    if progress {
        let _ = app.emit("fs-progress", json!({ "url": url, "bytes": got, "contentLength": total.max(got) }));
    }
    Ok(json!({ "path": p.to_string_lossy() }))
}
