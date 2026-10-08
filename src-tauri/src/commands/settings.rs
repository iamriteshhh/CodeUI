//! Preferences persisted to `~/.config/codeui/settings.json`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
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
        self.run_timeout_secs = self
            .run_timeout_secs
            .clamp(crate::proc::MIN_TIMEOUT_SECS, crate::proc::MAX_TIMEOUT_SECS);
        if self.theme != "light" {
            self.theme = "dark".into();
        }
        self
    }
}

pub struct SettingsStore {
    path: PathBuf,
    current: Arc<Mutex<Settings>>,
    /// Incremented per save; a debounced writer only commits the latest.
    generation: Arc<AtomicU64>,
    /// Serializes disk writes so the debounced writer and `flush` never race.
    write_lock: Arc<Mutex<()>>,
    /// Why the last background write failed, reported by the next save.
    write_error: Arc<Mutex<Option<String>>>,
}

impl SettingsStore {
    pub fn load() -> Self {
        Self::load_from(settings_path().unwrap_or_else(|| PathBuf::from("codeui-settings.json")))
    }

    /// Reads `path`, falling back to defaults when it is missing or unreadable.
    /// A corrupt file is moved aside to `settings.json.bak` so the next save
    /// cannot silently destroy what the student had.
    pub fn load_from(path: PathBuf) -> Self {
        let current = match std::fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<Settings>(&raw).unwrap_or_else(|e| {
                let backup = path.with_extension("json.bak");
                eprintln!(
                    "codeui: settings file {} is corrupt ({e}); using defaults, original kept at {}",
                    path.display(),
                    backup.display()
                );
                let _ = std::fs::rename(&path, &backup);
                Settings::default()
            }),
            Err(_) => Settings::default(),
        }
        .sanitize();

        Self {
            path,
            current: Arc::new(Mutex::new(current)),
            generation: Arc::new(AtomicU64::new(0)),
            write_lock: Arc::new(Mutex::new(())),
            write_error: Arc::new(Mutex::new(None)),
        }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().expect("settings").clone()
    }

    /// Updates memory immediately and schedules a debounced disk write.
    ///
    /// The new settings always take effect. If the previous background write
    /// failed (read-only config dir, disk full) that failure is returned here
    /// so the UI can tell the student their preferences are not being kept.
    pub fn save(&self, next: Settings) -> Result<Settings, SettingsError> {
        let next = next.sanitize();
        *self.current.lock().expect("settings") = next.clone();

        let generation = Arc::clone(&self.generation);
        let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;
        let path = self.path.clone();
        let current = Arc::clone(&self.current);
        let write_lock = Arc::clone(&self.write_lock);
        let write_error = Arc::clone(&self.write_error);

        std::thread::spawn(move || {
            std::thread::sleep(DEBOUNCE);
            let _guard = write_lock.lock().unwrap_or_else(PoisonError::into_inner);
            // A newer save landed during the window; let it do the writing.
            // Writes whatever is current, so a racing save can never leave
            // an older value on disk than in memory.
            if generation.load(Ordering::SeqCst) != mine {
                return;
            }
            let latest = current.lock().expect("settings").clone();
            let result = write_to_disk(&path, &latest);
            *write_error.lock().unwrap_or_else(PoisonError::into_inner) =
                result.err().map(|e| e.to_string());
        });

        match self
            .write_error
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            Some(err) => Err(SettingsError::Io(err)),
            None => Ok(next),
        }
    }

    /// Writes synchronously, skipping the debounce. Used on app exit.
    pub fn flush(&self) -> Result<(), SettingsError> {
        let _guard = self
            .write_lock
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let result = write_to_disk(&self.path, &self.get());
        *self
            .write_error
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = None;
        result
    }

    pub fn path(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }
}

/// Write-then-rename in the same directory, so a crash, a full disk or a
/// concurrent writer can never leave a truncated settings file behind.
fn write_to_disk(path: &Path, settings: &Settings) -> Result<(), SettingsError> {
    let io_err = |e: std::io::Error| {
        SettingsError::Io(format!(
            "could not save settings to {}: {e}",
            path.display()
        ))
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io_err)?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| SettingsError::Corrupt(e.to_string()))?;

    // Per-process name: two CodeUI instances must not share a temp file.
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let written = std::fs::File::create(&tmp)
        .and_then(|mut f| {
            f.write_all(json.as_bytes())?;
            // Surface ENOSPC here, before the old file is replaced.
            f.sync_all()
        })
        .and_then(|_| std::fs::rename(&tmp, path));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&tmp);
        return Err(io_err(e));
    }
    Ok(())
}

fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("codeui").join("settings.json"))
}

#[tauri::command]
pub fn load_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn save_settings(
    store: State<'_, SettingsStore>,
    settings: Settings,
) -> Result<Settings, SettingsError> {
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
        SettingsStore::load_from(dir.path().join("codeui").join("settings.json"))
    }

    fn leftover_temp_files(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect()
    }

    #[test]
    fn defaults_are_in_range() {
        let s = Settings::default();
        assert_eq!(s.font_size, 14);
        assert_eq!(s.tab_width, 4);
        assert_eq!(s.run_timeout_secs, crate::proc::DEFAULT_TIMEOUT_SECS);
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

        store
            .save(Settings {
                theme: "light".into(),
                font_size: 18,
                ..Settings::default()
            })
            .unwrap();
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
            store
                .save(Settings {
                    font_size: size,
                    ..Settings::default()
                })
                .unwrap();
        }
        // In-memory state is current immediately, before any disk write lands.
        assert_eq!(store.get().font_size, 20);

        std::thread::sleep(DEBOUNCE + Duration::from_millis(250));
        let raw = std::fs::read_to_string(&store.path).expect("debounced write");
        let loaded: Settings = serde_json::from_str(&raw).unwrap();
        assert_eq!(loaded.font_size, 20);
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults_and_is_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ not json").unwrap();

        let store = SettingsStore::load_from(path.clone());
        assert_eq!(store.get(), Settings::default());
        // The broken original is preserved, not overwritten by the next save.
        assert_eq!(
            std::fs::read_to_string(dir.path().join("settings.json.bak")).unwrap(),
            "{ not json"
        );
        store.flush().unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            serde_json::from_str::<Settings>(&raw).unwrap(),
            Settings::default()
        );
    }

    #[test]
    fn wrong_typed_field_is_treated_as_corrupt() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"fontSize":"huge"}"#).unwrap();
        assert_eq!(SettingsStore::load_from(path).get(), Settings::default());
    }

    #[test]
    fn missing_file_uses_defaults_without_backup() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::load_from(dir.path().join("settings.json"));
        assert_eq!(store.get(), Settings::default());
        assert!(!dir.path().join("settings.json.bak").exists());
    }

    #[test]
    fn concurrent_writes_leave_a_whole_file_and_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(store_at(&dir));

        let workers: Vec<_> = (0..8u8)
            .map(|i| {
                let store = Arc::clone(&store);
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        store
                            .save(Settings {
                                font_size: 12 + i,
                                ..Settings::default()
                            })
                            .unwrap();
                        store.flush().unwrap();
                    }
                })
            })
            .collect();
        for w in workers {
            w.join().unwrap();
        }
        std::thread::sleep(DEBOUNCE + Duration::from_millis(250));

        let raw = std::fs::read_to_string(&store.path).unwrap();
        let on_disk: Settings = serde_json::from_str(&raw).expect("never a torn write");
        assert_eq!(on_disk, store.get(), "the latest settings land last");
        assert!(leftover_temp_files(store.path.parent().unwrap()).is_empty());
    }

    #[test]
    fn write_failures_are_reported_not_swallowed() {
        let dir = tempfile::tempdir().unwrap();
        // A file where the config directory should be: every write must fail.
        let blocker = dir.path().join("codeui");
        std::fs::write(&blocker, "").unwrap();
        let store = SettingsStore::load_from(blocker.join("settings.json"));

        assert!(matches!(store.flush(), Err(SettingsError::Io(_))));

        // The debounced write fails in the background; the next save says so,
        // while still applying the new value in memory.
        store.save(Settings::default()).unwrap();
        std::thread::sleep(DEBOUNCE + Duration::from_millis(250));
        let next = Settings {
            font_size: 16,
            ..Settings::default()
        };
        assert!(matches!(store.save(next), Err(SettingsError::Io(_))));
        assert_eq!(store.get().font_size, 16);
    }
}
