//! Preferences persisted to `~/.config/codeui/settings.json`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

/// Window during which rapid changes (dragging a font-size slider) collapse
/// into a single disk write.
const DEBOUNCE: Duration = Duration::from_millis(400);

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum SettingsError {
    #[error("settings file is corrupt: {0}")]
    Corrupt(String),
    #[error("{0}")]
    Io(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub font_size: u8,
    pub tab_width: u8,
    pub shell_path: Option<String>,
    pub run_timeout_secs: u64,
    pub last_folder: Option<String>,
    pub recent_folders: Vec<String>,
    pub show_welcome_on_startup: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            font_size: 14,
            tab_width: 4,
            shell_path: None,
            run_timeout_secs: crate::proc::DEFAULT_TIMEOUT_SECS,
            last_folder: None,
            recent_folders: Vec::new(),
            show_welcome_on_startup: true,
        }
    }
}

impl Settings {
    /// Clamps values the UI could otherwise push out of range.
    fn sanitize(mut self) -> Self {
        self.font_size = self.font_size.clamp(12, 24);
        self.tab_width = if self.tab_width == 2 { 2 } else { 4 };
        self.run_timeout_secs = self.run_timeout_secs.clamp(1, 300);
        if self.theme != "light" {
            self.theme = "dark".into();
        }
        self
    }
}

pub struct SettingsStore {
    path: PathBuf,
    current: Mutex<Settings>,
    /// Incremented per save; a debounced writer only commits the latest.
    generation: Arc<AtomicU64>,
}

impl SettingsStore {
    pub fn load() -> Self {
        let path = settings_path().unwrap_or_else(|| PathBuf::from("codeui-settings.json"));
        let current = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default()
            .sanitize();

        Self {
            path,
            current: Mutex::new(current),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().expect("settings").clone()
    }

    /// Updates memory immediately and schedules a debounced disk write.
    pub fn save(&self, next: Settings) -> Settings {
        let next = next.sanitize();
        *self.current.lock().expect("settings") = next.clone();

        let generation = Arc::clone(&self.generation);
        let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let path = self.path.clone();
        let snapshot = next.clone();

        std::thread::spawn(move || {
            std::thread::sleep(DEBOUNCE);
            // A newer save landed during the window; let it do the writing.
            if generation.load(Ordering::SeqCst) != mine {
                return;
            }
            let _ = write_to_disk(&path, &snapshot);
        });

        next
    }

    /// Writes synchronously, skipping the debounce. Used on window close.
    pub fn flush(&self) -> Result<(), SettingsError> {
        let snapshot = self.get();
        write_to_disk(&self.path, &snapshot)
    }

    pub fn path(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

fn write_to_disk(path: &PathBuf, settings: &Settings) -> Result<(), SettingsError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| SettingsError::Io(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| SettingsError::Corrupt(e.to_string()))?;

    // Write-then-rename so a crash mid-write cannot truncate the existing file.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| SettingsError::Io(e.to_string()))?;
    std::fs::rename(&tmp, path).map_err(|e| SettingsError::Io(e.to_string()))
}

fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("codeui").join("settings.json"))
}

#[tauri::command]
pub fn load_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn save_settings(store: State<'_, SettingsStore>, settings: Settings) -> Settings {
    store.save(settings)
}

#[tauri::command]
pub fn flush_settings(store: State<'_, SettingsStore>) -> Result<(), SettingsError> {
    store.flush()
}

#[tauri::command]
pub fn settings_file_path(store: State<'_, SettingsStore>) -> String {
    store.path()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_at(dir: &tempfile::TempDir) -> SettingsStore {
        SettingsStore {
            path: dir.path().join("codeui").join("settings.json"),
            current: Mutex::new(Settings::default()),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }

    #[test]
    fn defaults_are_in_range() {
        let s = Settings::default();
        assert_eq!(s.font_size, 14);
        assert_eq!(s.tab_width, 4);
        assert_eq!(s.run_timeout_secs, 12);
    }

    #[test]
    fn out_of_range_values_are_clamped() {
        let wild = Settings {
            theme: "neon".into(),
            font_size: 200,
            tab_width: 9,
            run_timeout_secs: 99_999,
            ..Settings::default()
        }
        .sanitize();

        assert_eq!(wild.font_size, 24);
        assert_eq!(wild.tab_width, 4);
        assert_eq!(wild.theme, "dark");
        assert_eq!(wild.run_timeout_secs, 300);
    }

    #[test]
    fn flush_round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_at(&dir);

        store.save(Settings {
            theme: "light".into(),
            font_size: 18,
            ..Settings::default()
        });
        store.flush().unwrap();

        let raw = std::fs::read_to_string(&store.path).unwrap();
        let loaded: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(loaded.theme, "light");
        assert_eq!(loaded.font_size, 18);
    }

    #[test]
    fn debounce_collapses_rapid_saves() {
        let dir = tempfile::tempdir().unwrap();
        let store = store_at(&dir);

        for size in 12..=20u8 {
            store.save(Settings {
                font_size: size,
                ..Settings::default()
            });
        }
        // In-memory state is current immediately, before any disk write lands.
        assert_eq!(store.get().font_size, 20);

        std::thread::sleep(DEBOUNCE + Duration::from_millis(250));
        let raw = std::fs::read_to_string(&store.path).expect("debounced write");
        let loaded: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(loaded.font_size, 20);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json").unwrap();

        let recovered = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default();
        assert_eq!(recovered, Settings::default());
    }
}
