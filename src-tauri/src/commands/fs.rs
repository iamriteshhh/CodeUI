//! Filesystem commands. Each maps 1:1 to a typed wrapper in `src/services/fsService.ts`.
//!
//! Every path is scoped to the open workspace by [`WorkspaceState`]; the
//! `*_sync` helpers take the state explicitly so tests can drive them directly.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::commands::workspace::WorkspaceState;

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("no such file or directory: {0}")]
    NotFound(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("not a directory: {0}")]
    NotADirectory(String),
    #[error("file is not valid UTF-8 text: {0}")]
    NotUtf8(String),
    #[error("path is empty or invalid")]
    InvalidPath,
    #[error("{0}")]
    Io(String),
}

/// `{ kind, message }` with `message` the readable text (the derived form sent only the
/// path, or nothing for unit variants).
impl Serialize for FsError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let kind = match self {
            FsError::NotFound(_) => "NotFound",
            FsError::PermissionDenied(_) => "PermissionDenied",
            FsError::AlreadyExists(_) => "AlreadyExists",
            FsError::NotADirectory(_) => "NotADirectory",
            FsError::NotUtf8(_) => "NotUtf8",
            FsError::InvalidPath => "InvalidPath",
            FsError::Io(_) => "Io",
        };
        let mut out = serializer.serialize_struct("FsError", 2)?;
        out.serialize_field("kind", kind)?;
        out.serialize_field("message", &self.to_string())?;
        out.end()
    }
}

impl FsError {
    fn from_io(err: std::io::Error, path: &Path) -> Self {
        let p = path.display().to_string();
        match err.kind() {
            ErrorKind::NotFound => FsError::NotFound(p),
            ErrorKind::PermissionDenied => FsError::PermissionDenied(p),
            ErrorKind::AlreadyExists => FsError::AlreadyExists(p),
            ErrorKind::InvalidData => FsError::NotUtf8(p),
            _ => FsError::Io(format!("{p}: {err}")),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Seconds since the Unix epoch, or `null` if the platform withholds it.
    pub modified: Option<u64>,
}

/// Runs a scoped filesystem operation off the IPC thread.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    op: impl FnOnce(&WorkspaceState) -> Result<T, FsError> + Send + 'static,
) -> Result<T, FsError> {
    tauri::async_runtime::spawn_blocking(move || op(&app.state::<WorkspaceState>()))
        .await
        .map_err(|e| FsError::Io(e.to_string()))?
}

/// The workspace root itself may be listed and searched but never deleted or renamed.
fn refuse_root(ws: &WorkspaceState, p: &Path) -> Result<(), FsError> {
    if ws.root().as_deref() == Some(p) {
        return Err(FsError::PermissionDenied(format!(
            "Refusing to modify the workspace folder itself: {}",
            p.display()
        )));
    }
    Ok(())
}

/// Identifies filesystem roots and critical OS paths to guard against destructive mutations.
pub fn is_dangerous_system_path(path: &Path) -> bool {
    let components: Vec<_> = path.components().collect();
    if components.is_empty() {
        return true;
    }
    // Check if path is solely a root or drive prefix (e.g. "/" or "C:\")
    if components.len() == 1 {
        match components[0] {
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return true,
            _ => {}
        }
    }
    if components.len() == 2
        && matches!(components[0], std::path::Component::Prefix(_))
        && matches!(components[1], std::path::Component::RootDir)
    {
        return true;
    }

    let normalized = path.to_string_lossy().to_lowercase().replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');

    // Windows drive roots and system directories
    if trimmed.len() == 2 && trimmed.ends_with(':') {
        return true;
    }
    let win_sys = [
        "c:/windows",
        "c:/program files",
        "c:/program files (x86)",
        "c:/programdata",
    ];
    for sys in win_sys {
        if trimmed == sys || trimmed.starts_with(&format!("{sys}/")) {
            return true;
        }
    }

    // Unix system directories
    let unix_sys = [
        "/etc", "/bin", "/sbin", "/usr", "/boot", "/dev", "/proc", "/sys", "/lib", "/lib64",
    ];
    for sys in unix_sys {
        if trimmed == sys || trimmed.starts_with(&format!("{sys}/")) {
            return true;
        }
    }

    false
}

pub fn read_file_sync(ws: &WorkspaceState, path: &str) -> Result<String, FsError> {
    let p = ws.resolve(path)?;
    std::fs::read_to_string(&p).map_err(|e| FsError::from_io(e, &p))
}

#[tauri::command]
pub async fn read_file(app: AppHandle, path: String) -> Result<String, FsError> {
    blocking(app, move |ws| read_file_sync(ws, &path)).await
}

pub fn write_file_sync(ws: &WorkspaceState, path: &str, contents: &str) -> Result<(), FsError> {
    let p = ws.resolve(path)?;
    if is_dangerous_system_path(&p) {
        return Err(FsError::PermissionDenied(format!(
            "Refusing to write to protected system path: {path}"
        )));
    }
    let parent = p.parent().ok_or(FsError::InvalidPath)?;
    let name = p.file_name().ok_or(FsError::InvalidPath)?.to_string_lossy();

    // rename() only needs write access to the directory, so it would happily
    // replace a read-only file. Probe the target first to surface the real
    // permission error instead of silently overwriting.
    let existing = std::fs::metadata(&p).ok();
    if existing.is_some() {
        std::fs::OpenOptions::new()
            .write(true)
            .open(&p)
            .map_err(|e| FsError::from_io(e, &p))?;
    }

    // Unique per save: two saves of one file in flight must not share (and steal) a temp file.
    static SAVE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SAVE_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = parent.join(format!(".{name}.{}-{seq}.codeui-tmp", std::process::id()));
    std::fs::write(&tmp, contents).map_err(|e| FsError::from_io(e, &tmp))?;

    // The temp file is created fresh, so carry the original's mode across.
    if let Some(meta) = existing {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }

    // Rename temporary file over target with backoff retries (Y2).
    // Mitigates transient Windows Defender / filesystem sharing violations.
    let mut rename_result = std::fs::rename(&tmp, &p);
    let mut backoff_ms = 10;
    for _ in 0..5 {
        if rename_result.is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(backoff_ms));
        backoff_ms *= 2;
        rename_result = std::fs::rename(&tmp, &p);
    }

    if let Err(e) = rename_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(FsError::from_io(e, &p));
    }

    Ok(())
}

#[tauri::command]
pub async fn write_file(app: AppHandle, path: String, contents: String) -> Result<(), FsError> {
    blocking(app, move |ws| write_file_sync(ws, &path, &contents)).await
}

pub fn list_dir_sync(ws: &WorkspaceState, path: &str) -> Result<Vec<FileEntry>, FsError> {
    let p = ws.resolve(path)?;
    if p.exists() && !p.is_dir() {
        return Err(FsError::NotADirectory(p.display().to_string()));
    }

    let entries = std::fs::read_dir(&p).map_err(|e| FsError::from_io(e, &p))?;
    let mut out = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| FsError::from_io(e, &p))?;
        // A broken symlink must not abort the whole listing.
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs());

        out.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            // Report children in the form the UI asked with, not the canonical one.
            path: Path::new(path)
                .join(entry.file_name())
                .to_string_lossy()
                .into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            modified,
        });
    }

    // Folders first, then case-insensitive alphabetical.
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

#[tauri::command]
pub async fn list_dir(app: AppHandle, path: String) -> Result<Vec<FileEntry>, FsError> {
    blocking(app, move |ws| list_dir_sync(ws, &path)).await
}

pub fn create_file_sync(ws: &WorkspaceState, path: &str) -> Result<(), FsError> {
    let p = ws.resolve(path)?;
    if is_dangerous_system_path(&p) {
        return Err(FsError::PermissionDenied(format!(
            "Refusing to create file in protected system path: {path}"
        )));
    }
    if p.exists() {
        return Err(FsError::AlreadyExists(p.display().to_string()));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| FsError::from_io(e, parent))?;
    }
    // create_new never follows or replaces whatever appeared since the check.
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&p)
        .map(drop)
        .map_err(|e| FsError::from_io(e, &p))
}

#[tauri::command]
pub async fn create_file(app: AppHandle, path: String) -> Result<(), FsError> {
    blocking(app, move |ws| create_file_sync(ws, &path)).await
}

pub fn create_dir_sync(ws: &WorkspaceState, path: &str) -> Result<(), FsError> {
    let p = ws.resolve(path)?;
    if is_dangerous_system_path(&p) {
        return Err(FsError::PermissionDenied(format!(
            "Refusing to create directory in protected system path: {path}"
        )));
    }
    if p.exists() {
        return Err(FsError::AlreadyExists(p.display().to_string()));
    }
    std::fs::create_dir_all(&p).map_err(|e| FsError::from_io(e, &p))
}

#[tauri::command]
pub async fn create_dir(app: AppHandle, path: String) -> Result<(), FsError> {
    blocking(app, move |ws| create_dir_sync(ws, &path)).await
}

pub fn rename_file_sync(
    ws: &WorkspaceState,
    old_path: &str,
    new_path: &str,
) -> Result<(), FsError> {
    let from = ws.resolve_entry(old_path)?;
    let to = ws.resolve_entry(new_path)?;
    refuse_root(ws, &from)?;
    if is_dangerous_system_path(&from) || is_dangerous_system_path(&to) {
        return Err(FsError::PermissionDenied(
            "Cannot rename protected system or root paths".into(),
        ));
    }
    if std::fs::symlink_metadata(&from).is_err() {
        return Err(FsError::NotFound(from.display().to_string()));
    }
    // rename() would silently clobber an existing target. On a case-insensitive filesystem
    // (Windows, macOS) `main.java` -> `Main.java` finds the file itself; that is not a clash.
    if std::fs::symlink_metadata(&to).is_ok() && !same_file(&from, &to) {
        return Err(FsError::AlreadyExists(to.display().to_string()));
    }
    std::fs::rename(&from, &to).map_err(|e| FsError::from_io(e, &from))
}

#[tauri::command]
pub async fn rename_file(
    app: AppHandle,
    old_path: String,
    new_path: String,
) -> Result<(), FsError> {
    blocking(app, move |ws| rename_file_sync(ws, &old_path, &new_path)).await
}

/// Both paths name the same file (case-insensitive filesystems, or the same link target).
fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

pub fn delete_file_sync(ws: &WorkspaceState, path: &str) -> Result<(), FsError> {
    let p = ws.resolve_entry(path)?;
    refuse_root(ws, &p)?;
    if is_dangerous_system_path(&p) {
        return Err(FsError::PermissionDenied(format!(
            "Refusing to delete protected system path: {path}"
        )));
    }
    let meta = std::fs::symlink_metadata(&p).map_err(|e| FsError::from_io(e, &p))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| FsError::from_io(e, &p))
    } else if meta.is_symlink() {
        // Removes the link only. Windows directory links need remove_dir.
        std::fs::remove_file(&p)
            .or_else(|_| std::fs::remove_dir(&p))
            .map_err(|e| FsError::from_io(e, &p))
    } else {
        std::fs::remove_file(&p).map_err(|e| FsError::from_io(e, &p))
    }
}

#[tauri::command]
pub async fn delete_file(app: AppHandle, path: String) -> Result<(), FsError> {
    blocking(app, move |ws| delete_file_sync(ws, &path)).await
}

/// Unscoped on purpose: the UI checks the remembered folder before opening it.
/// It only ever reveals a boolean.
#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.trim().is_empty() && Path::new(&path).exists()
}

#[tauri::command]
pub async fn pick_folder(default_path: Option<String>) -> Result<Option<String>, String> {
    let res = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Select Folder");
        if let Some(ref path) = default_path {
            let p = Path::new(path);
            if p.exists() {
                dialog = dialog.set_directory(p);
            }
        }
        dialog
            .pick_folder()
            .map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(res)
}

/// The picked file is allowlisted so it can be opened even when it lies
/// outside the workspace; nothing else outside the workspace is.
#[tauri::command]
pub async fn pick_file(
    state: State<'_, WorkspaceState>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let res = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = rfd::FileDialog::new().set_title("Open File");
        if let Some(ref path) = default_path {
            let p = Path::new(path);
            if p.exists() {
                if p.is_dir() {
                    dialog = dialog.set_directory(p);
                } else if let Some(parent) = p.parent() {
                    dialog = dialog.set_directory(parent);
                }
            }
        }
        dialog.pick_file().map(|p| p.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(path) = &res {
        state
            .allow_external(Path::new(path))
            .map_err(|e| e.to_string())?;
    }
    Ok(res)
}

#[tauri::command]
pub fn open_in_file_manager(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Path does not exist".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
    }

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub file_path: String,
    pub file_name: String,
    pub line_number: usize,
    pub line_content: String,
}

/// Resolves a search root inside the workspace (the root or a subfolder).
fn search_root(ws: &WorkspaceState, requested: &str) -> Result<PathBuf, FsError> {
    let root = ws.resolve(requested)?;
    if !root.is_dir() {
        return Err(FsError::NotADirectory(requested.to_string()));
    }
    Ok(root)
}

/// Reports a hit under the root the UI sent rather than the canonical one.
fn display_path(requested: &Path, canon_root: &Path, found: &Path) -> String {
    found
        .strip_prefix(canon_root)
        .map(|rel| requested.join(rel))
        .unwrap_or_else(|_| found.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

pub fn search_files_sync(
    ws: &WorkspaceState,
    workspace_path: &str,
    query: &str,
    is_case_sensitive: bool,
    limit: usize,
) -> Result<Vec<SearchResult>, FsError> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let root = search_root(ws, workspace_path)?;
    let requested = Path::new(workspace_path);

    let mut matches = Vec::new();
    // follow_links(false): a symlink inside the workspace must not lead the walk out of it.
    let walker = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !name.starts_with(".git")
                && name != "node_modules"
                && name != "target"
                && name != "dist"
                && name != ".next"
                && name != "__pycache__"
                && name != ".venv"
        });

    for entry in walker.filter_map(|e| e.ok()) {
        if matches.len() >= limit {
            break;
        }

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if let Ok(metadata) = entry.metadata() {
            if metadata.len() > 2 * 1024 * 1024 {
                continue;
            }
        }

        if let Ok(content) = std::fs::read_to_string(path) {
            let file_path = display_path(requested, &root, path);
            let file_name = entry.file_name().to_string_lossy().to_string();

            for (idx, line) in content.lines().enumerate() {
                let is_match = if is_case_sensitive {
                    line.contains(&q)
                } else {
                    line.to_lowercase().contains(&q.to_lowercase())
                };

                if is_match {
                    matches.push(SearchResult {
                        file_path: file_path.clone(),
                        file_name: file_name.clone(),
                        line_number: idx + 1,
                        line_content: line.trim().to_string(),
                    });

                    if matches.len() >= limit {
                        break;
                    }
                }
            }
        }
    }
    Ok(matches)
}

#[tauri::command]
pub async fn search_files(
    app: AppHandle,
    workspace_path: String,
    query: String,
    case_sensitive: Option<bool>,
    max_results: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    blocking(app, move |ws| {
        search_files_sync(
            ws,
            &workspace_path,
            &query,
            case_sensitive.unwrap_or(false),
            max_results.unwrap_or(100),
        )
    })
    .await
    .map_err(|e| e.to_string())
}

pub fn find_files_sync(
    ws: &WorkspaceState,
    workspace_path: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<FileEntry>, FsError> {
    let root = search_root(ws, workspace_path)?;
    let requested = Path::new(workspace_path);
    let q = query.trim().to_lowercase();

    let mut matches = Vec::new();
    // follow_links(false): a symlink inside the workspace must not lead the walk out of it.
    let walker = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !name.starts_with(".git")
                && name != "node_modules"
                && name != "target"
                && name != "dist"
                && name != ".next"
                && name != "__pycache__"
                && name != ".venv"
        });

    for entry_res in walker.filter_map(Result::ok) {
        if entry_res.file_type().is_file() {
            let file_name = entry_res.file_name().to_string_lossy().to_string();
            let full_path = display_path(requested, &root, entry_res.path());

            if q.is_empty()
                || file_name.to_lowercase().contains(&q)
                || full_path.to_lowercase().contains(&q)
            {
                let metadata = entry_res.metadata().ok();
                let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                let modified = metadata.and_then(|m| {
                    m.modified().ok().and_then(|t| {
                        t.duration_since(std::time::UNIX_EPOCH)
                            .ok()
                            .map(|d| d.as_secs())
                    })
                });

                matches.push(FileEntry {
                    name: file_name,
                    path: full_path,
                    is_dir: false,
                    size,
                    modified,
                });

                if matches.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(matches)
}

#[tauri::command]
pub async fn find_files(
    app: AppHandle,
    workspace_path: String,
    query: String,
    max_results: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    blocking(app, move |ws| {
        find_files_sync(ws, &workspace_path, &query, max_results.unwrap_or(50))
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    /// These tests exercise file behaviour, not scoping (see tests/fs_workspace_scope.rs),
    /// so the workspace is the system temp dir that every `tmp()` lives in.
    fn ws() -> WorkspaceState {
        let ws = WorkspaceState::default();
        ws.set_root(Some(&std::env::temp_dir().to_string_lossy()))
            .expect("temp dir as workspace");
        ws
    }

    fn read_file(path: String) -> Result<String, FsError> {
        read_file_sync(&ws(), &path)
    }

    fn write_file(path: String, contents: String) -> Result<(), FsError> {
        write_file_sync(&ws(), &path, &contents)
    }

    fn list_dir(path: String) -> Result<Vec<FileEntry>, FsError> {
        list_dir_sync(&ws(), &path)
    }

    fn create_file(path: String) -> Result<(), FsError> {
        create_file_sync(&ws(), &path)
    }

    fn rename_file(old_path: String, new_path: String) -> Result<(), FsError> {
        rename_file_sync(&ws(), &old_path, &new_path)
    }

    fn delete_file(path: String) -> Result<(), FsError> {
        delete_file_sync(&ws(), &path)
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = tmp();
        let file = dir.path().join("hello.c");
        let path = file.to_string_lossy().into_owned();

        write_file(path.clone(), "int main(){}".into()).unwrap();
        assert_eq!(read_file(path).unwrap(), "int main(){}");
    }

    #[test]
    fn save_leaves_no_temp_file_behind() {
        let dir = tmp();
        let file = dir.path().join("main.c");
        let path = file.to_string_lossy().into_owned();

        write_file(path.clone(), "first".into()).unwrap();
        write_file(path.clone(), "second".into()).unwrap();

        assert_eq!(read_file(path).unwrap(), "second");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains("codeui-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "stray temp files: {leftovers:?}");
    }

    #[test]
    fn case_only_rename_works() {
        // main.java -> Main.java: on Windows and macOS the target "exists" (it is the file itself).
        let dir = tmp();
        let from = dir.path().join("main.java");
        std::fs::write(&from, "class Main {}").unwrap();
        let to = dir.path().join("Main.java");
        rename_file(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap();
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["Main.java".to_string()]);
    }

    #[test]
    fn rename_onto_a_different_file_is_still_refused() {
        let dir = tmp();
        let a = dir.path().join("a.c");
        let b = dir.path().join("b.c");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();
        assert!(matches!(
            rename_file(
                a.to_string_lossy().into_owned(),
                b.to_string_lossy().into_owned()
            ),
            Err(FsError::AlreadyExists(_))
        ));
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "b");
    }

    #[test]
    fn concurrent_saves_of_one_file_all_succeed() {
        let dir = tmp();
        let path = dir.path().join("race.c").to_string_lossy().into_owned();
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let path = path.clone();
                std::thread::spawn(move || write_file(path, format!("version {i}")))
            })
            .collect();
        for h in handles {
            h.join().unwrap().expect("every save succeeds");
        }
        assert!(read_file(path).unwrap().starts_with("version "));
        let leftovers = std::fs::read_dir(dir.path())
            .unwrap()
            .filter(|e| {
                e.as_ref()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .contains("codeui-tmp")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn save_replaces_content_rather_than_appending() {
        let dir = tmp();
        let file = dir.path().join("notes.py");
        let path = file.to_string_lossy().into_owned();

        write_file(path.clone(), "a long original line".into()).unwrap();
        write_file(path.clone(), "short".into()).unwrap();
        assert_eq!(read_file(path).unwrap(), "short");
    }

    #[cfg(unix)]
    #[test]
    fn save_preserves_the_executable_bit() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp();
        let file = dir.path().join("build.sh");
        std::fs::write(&file, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();

        write_file(
            file.to_string_lossy().into_owned(),
            "#!/bin/sh\necho hi\n".into(),
        )
        .unwrap();

        let mode = std::fs::metadata(&file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755, "rename must not drop the mode");
    }

    #[cfg(unix)]
    #[test]
    fn saving_a_read_only_file_is_refused() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp();
        let file = dir.path().join("locked.c");
        std::fs::write(&file, "original").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o444)).unwrap();

        let result = write_file(file.to_string_lossy().into_owned(), "overwritten".into());

        if unsafe { libc::geteuid() } != 0 {
            assert!(matches!(result, Err(FsError::PermissionDenied(_))));
            // Renaming over it would have silently succeeded; prove it did not.
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
        }
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644));
    }

    #[test]
    fn missing_file_is_not_found() {
        let dir = tmp();
        let missing = dir.path().join("ghost.txt").to_string_lossy().into_owned();
        assert!(matches!(read_file(missing), Err(FsError::NotFound(_))));
    }

    #[test]
    fn empty_path_is_rejected() {
        assert!(matches!(read_file("  ".into()), Err(FsError::InvalidPath)));
    }

    #[test]
    fn listing_sorts_dirs_first() {
        let dir = tmp();
        std::fs::write(dir.path().join("b.txt"), "").unwrap();
        std::fs::write(dir.path().join("a.txt"), "").unwrap();
        std::fs::create_dir(dir.path().join("zfolder")).unwrap();

        let listed = list_dir(dir.path().to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = listed.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["zfolder", "a.txt", "b.txt"]);
        assert!(listed[0].is_dir);
    }

    #[test]
    fn listing_a_file_reports_not_a_directory() {
        let dir = tmp();
        let file = dir.path().join("f.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(matches!(
            list_dir(file.to_string_lossy().into_owned()),
            Err(FsError::NotADirectory(_))
        ));
    }

    #[test]
    fn rename_refuses_to_clobber() {
        let dir = tmp();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        std::fs::write(&a, "a").unwrap();
        std::fs::write(&b, "b").unwrap();

        let err = rename_file(
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        );
        assert!(matches!(err, Err(FsError::AlreadyExists(_))));
        // The victim file is untouched.
        assert_eq!(std::fs::read_to_string(&b).unwrap(), "b");
    }

    #[test]
    fn create_file_rejects_existing() {
        let dir = tmp();
        let f = dir.path().join("x.py").to_string_lossy().into_owned();
        create_file(f.clone()).unwrap();
        assert!(matches!(create_file(f), Err(FsError::AlreadyExists(_))));
    }

    #[test]
    fn delete_removes_directory_tree() {
        let dir = tmp();
        let nested = dir.path().join("proj/src");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("main.c"), "").unwrap();

        let target = dir.path().join("proj");
        delete_file(target.to_string_lossy().into_owned()).unwrap();
        assert!(!target.exists());
    }

    #[test]
    fn find_files_locates_by_name() {
        let dir = tmp();
        let nested = dir.path().join("src/utils");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("helper.py"), "print(1)").unwrap();
        std::fs::write(dir.path().join("main.py"), "print(2)").unwrap();

        let found = find_files_sync(&ws(), &dir.path().to_string_lossy(), "help", 50).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "helper.py");
        // Reported under the root as sent, not its canonical form.
        assert!(found[0].path.starts_with(&*dir.path().to_string_lossy()));
    }

    #[cfg(unix)]
    #[test]
    fn read_only_file_reports_permission_denied() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp();
        let file = dir.path().join("locked.txt");
        std::fs::write(&file, "secret").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o000)).unwrap();

        let result = read_file(file.to_string_lossy().into_owned());
        // Root ignores permission bits, so only assert when the test user is not root.
        if unsafe { libc::geteuid() } != 0 {
            assert!(matches!(result, Err(FsError::PermissionDenied(_))));
        }
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644));
    }

    #[test]
    fn dangerous_system_path_detection() {
        assert!(is_dangerous_system_path(Path::new("/")));
        assert!(is_dangerous_system_path(Path::new("C:\\")));
        assert!(is_dangerous_system_path(Path::new("C:/Windows")));
        assert!(is_dangerous_system_path(Path::new("C:/Program Files/test")));
        assert!(is_dangerous_system_path(Path::new("/etc/passwd")));
        assert!(is_dangerous_system_path(Path::new("/usr/bin")));

        assert!(!is_dangerous_system_path(Path::new(
            "D:/projects/student/main.rs"
        )));
        assert!(!is_dangerous_system_path(Path::new(
            "/home/user/project/file.c"
        )));
    }

    #[test]
    fn write_and_delete_refuse_system_path() {
        // Outside the workspace (or not even absolute on this OS): refused either way.
        let err = write_file("C:/Windows/system32/cmd.exe".to_string(), "bad".to_string());
        assert!(matches!(
            err,
            Err(FsError::PermissionDenied(_) | FsError::InvalidPath)
        ));

        let del_err = delete_file("/etc".to_string());
        assert!(matches!(
            del_err,
            Err(FsError::PermissionDenied(_) | FsError::InvalidPath)
        ));
    }

    #[test]
    fn rapid_repeated_writes_succeed_atomically() {
        let dir = tmp();
        let file = dir.path().join("rapid.txt");
        let path_str = file.to_string_lossy().into_owned();

        for i in 0..25 {
            let content = format!("rapid save version {i}");
            write_file(path_str.clone(), content.clone()).unwrap();
            assert_eq!(read_file(path_str.clone()).unwrap(), content);
        }

        // Ensure no leftover temp files
        let tmp_files: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".codeui-tmp"))
            .collect();
        assert!(tmp_files.is_empty());
    }
}
