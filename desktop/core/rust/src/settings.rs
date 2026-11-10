// Ustawienia aplikacji: settings.json = wartości domyślne + zapisane
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Settings {
    file: PathBuf,
    cache: Arc<Mutex<Map<String, Value>>>,
}

impl Settings {
    pub fn load(file: PathBuf, defaults: Value) -> Self {
        let mut cache = defaults.as_object().cloned().unwrap_or_default();
        if let Some(Value::Object(saved)) = crate::util::read_json(&file) {
            cache.extend(saved);
        }
        Settings { file, cache: Arc::new(Mutex::new(cache)) }
    }
    pub fn all(&self) -> Value {
        Value::Object(self.cache.lock().unwrap().clone())
    }
    pub fn get(&self, key: &str) -> Value {
        self.cache.lock().unwrap().get(key).cloned().unwrap_or(Value::Null)
    }
    pub fn get_str(&self, key: &str) -> String {
        match self.get(key) {
            Value::String(s) => s,
            Value::Null => String::new(),
            v => v.to_string(),
        }
    }
    pub fn get_u64(&self, key: &str, fallback: u64) -> u64 {
        match self.get(key) {
            Value::Number(n) => n.as_u64().unwrap_or(fallback),
            Value::String(s) => s.parse().unwrap_or(fallback),
            _ => fallback,
        }
    }
    pub fn set(&self, key: &str, value: Value) -> Value {
        let mut c = self.cache.lock().unwrap();
        c.insert(key.to_string(), value);
        let _ = crate::util::write_json(&self.file, &Value::Object(c.clone()));
        Value::Object(c.clone())
    }
    /// Kilka naraz (obiekt JSON)
    pub fn merge(&self, patch: Value) -> Value {
        let mut c = self.cache.lock().unwrap();
        if let Value::Object(p) = patch {
            c.extend(p);
        }
        let _ = crate::util::write_json(&self.file, &Value::Object(c.clone()));
        Value::Object(c.clone())
    }
}
