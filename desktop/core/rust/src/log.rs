// Dziennik aplikacji: logs/app.log, po 1 MB stary plik przechodzi w app.log.1
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const MAX: u64 = 1024 * 1024;

#[derive(Clone)]
pub struct Logger {
    file: PathBuf,
    name: String,
    lock: Arc<Mutex<()>>,
}

impl Logger {
    pub fn new(logs_dir: &Path, name: &str) -> Self {
        let _ = fs::create_dir_all(logs_dir);
        Logger { file: logs_dir.join("app.log"), name: name.to_string(), lock: Arc::new(Mutex::new(())) }
    }
    pub fn file(&self) -> &Path {
        &self.file
    }
    fn write(&self, level: &str, text: &str) {
        let _g = self.lock.lock();
        let line = format!("{} [{}] {}\n", crate::util::now_iso(), level, text);
        if fs::metadata(&self.file).map(|m| m.len() > MAX).unwrap_or(false) {
            let _ = fs::rename(&self.file, self.file.with_extension("log.1"));
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&self.file) {
            let _ = f.write_all(line.as_bytes());
        }
        if level == "ERROR" {
            eprintln!("[{}] {}", self.name, text);
        } else {
            println!("[{}] {}", self.name, text);
        }
    }
    pub fn info(&self, text: impl AsRef<str>) {
        self.write("INFO", text.as_ref());
    }
    pub fn warn(&self, text: impl AsRef<str>) {
        self.write("WARN", text.as_ref());
    }
    pub fn error(&self, text: impl AsRef<str>) {
        self.write("ERROR", text.as_ref());
    }
}
