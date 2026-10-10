//! The open workspace folder, and the single gate every filesystem command
//! passes through so it can only touch files inside that folder.
//!
//! Paths are compared in canonical form: symlinks and `..` are resolved by the
//! OS before the containment check, so neither can be used to escape. The one
//! exception is a file the student explicitly picked in the "Open File"
//! dialog, which is allowlisted by exact path.

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::commands::fs::{is_dangerous_system_path, FsError};
use crate::commands::process::RunRegistry;
use crate::pty::PtyManager;

#[derive(Default)]
pub struct WorkspaceState {
    root: Mutex<Option<PathBuf>>,
    external: Mutex<HashSet<PathBuf>>,
}

impl WorkspaceState {
    /// The canonical workspace root, if a folder is open.
    pub fn root(&self) -> Option<PathBuf> {
        self.root.lock().expect("workspace root").clone()
    }

    /// Opens `path` as the workspace (`None` closes it) and clears the external
    /// allowlist. Returns the canonical root.
    pub fn set_root(&self, path: Option<&str>) -> Result<Option<PathBuf>, FsError> {
        let root = path.map(canonical_workspace_dir).transpose()?;
        self.store(root.clone());
        Ok(root)
    }

    fn store(&self, root: Option<PathBuf>) {
        *self.root.lock().expect("workspace root") = root;
        self.external.lock().expect("workspace external").clear();
    }

    /// Lets one file outside the workspace be opened, saved and run. Used only
    /// for the result of the native "Open File" dialog.
    pub fn allow_external(&self, path: &Path) -> Result<(), FsError> {
        let canon = canonical(path)?;
        if !canon.is_file() {
            return Err(FsError::InvalidPath);
        }
        self.external
            .lock()
            .expect("workspace external")
            .insert(canon);
        Ok(())
    }

    /// Resolves `path` (following symlinks, including the last component) and
    /// checks it lies inside the workspace or is an allowlisted file. Targets
    /// that do not exist yet are resolved through their nearest existing
    /// ancestor.
    pub fn resolve(&self, path: &str) -> Result<PathBuf, FsError> {
        let input = checked_input(path)?;
        let mut result = self.check(path, resolve_lexical_tail(input)?, true);
        // While another save replaces the file, Windows can report the old copy's path
        // (moved to a hidden system folder until its handles close), which fails the
        // containment check. Resolve again before refusing; real escapes stay refused.
        for _ in 0..4 {
            if !matches!(result, Err(FsError::PermissionDenied(_))) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
            result = self.check(path, resolve_lexical_tail(input)?, true);
        }
        result
    }

    /// Like [`resolve`](Self::resolve) but does not follow the last component,
    /// so a symlink inside the workspace can be renamed or deleted without
    /// touching what it points at. Workspace only: allowlisted external files
    /// can be edited but not renamed or deleted.
    pub fn resolve_entry(&self, path: &str) -> Result<PathBuf, FsError> {
        let p = checked_input(path)?;
        let name = p.file_name().ok_or(FsError::InvalidPath)?;
        let parent = p.parent().ok_or(FsError::InvalidPath)?;
        let resolved = resolve_lexical_tail(parent)?.join(name);
        self.check(path, resolved, false)
    }

    fn check(
        &self,
        original: &str,
        resolved: PathBuf,
        allow_external: bool,
    ) -> Result<PathBuf, FsError> {
        if let Some(root) = self.root.lock().expect("workspace root").as_ref() {
            if resolved.starts_with(root) {
                return Ok(resolved);
            }
        }
        if allow_external
            && self
                .external
                .lock()
                .expect("workspace external")
                .contains(&resolved)
        {
            return Ok(resolved);
        }
        let reason = if self.root().is_some() {
            "outside the open workspace"
        } else {
            "no workspace folder is open"
        };
        Err(FsError::PermissionDenied(format!("{reason}: {original}")))
    }
}

/// Resolves a path the frontend sent against the open workspace. The returned
/// path is canonical (symlinks resolved, no `\\?\` prefix on Windows).
pub fn resolve_in_workspace(state: &WorkspaceState, path: &str) -> Result<PathBuf, FsError> {
    state.resolve(path)
}

/// Rejects empty, relative, and `..`-bearing input before touching the disk.
fn checked_input(path: &str) -> Result<&Path, FsError> {
    let p = Path::new(path);
    if path.trim().is_empty()
        || !p.is_absolute()
        || p.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err(FsError::InvalidPath);
    }
    Ok(p)
}

/// Canonicalizes the nearest existing ancestor and re-appends the missing
/// tail. `checked_input` guarantees the tail is only normal components.
fn resolve_lexical_tail(p: &Path) -> Result<PathBuf, FsError> {
    let mut existing = p.to_path_buf();
    let mut tail = Vec::new();
    loop {
        match canonical(&existing) {
            Ok(c) => {
                let mut out = c;
                out.extend(tail.iter().rev());
                return Ok(out);
            }
            Err(FsError::NotFound(_)) => {
                // Present but unresolvable means a dangling symlink; writing
                // through it could create its target anywhere.
                if std::fs::symlink_metadata(&existing).is_ok() {
                    return Err(FsError::PermissionDenied(format!(
                        "broken symlink: {}",
                        existing.display()
                    )));
                }
                let name = existing.file_name().ok_or(FsError::InvalidPath)?;
                tail.push(name.to_os_string());
                if !existing.pop() {
                    return Err(FsError::NotFound(p.display().to_string()));
                }
            }
            Err(e) => return Err(e),
        }
    }
}

fn canonical(p: &Path) -> Result<PathBuf, FsError> {
    std::fs::canonicalize(p)
        .map(strip_verbatim)
        .map_err(|e| match e.kind() {
            ErrorKind::NotFound => FsError::NotFound(p.display().to_string()),
            ErrorKind::PermissionDenied => FsError::PermissionDenied(p.display().to_string()),
            _ => FsError::Io(format!("{}: {e}", p.display())),
        })
}

fn canonical_workspace_dir(path: &str) -> Result<PathBuf, FsError> {
    let p = checked_input(path)?;
    let canon = canonical(p)?;
    if !canon.is_dir() {
        return Err(FsError::NotADirectory(path.to_string()));
    }
    if is_dangerous_system_path(&canon) {
        return Err(FsError::PermissionDenied(format!(
            "Refusing to open protected system path as a workspace: {path}"
        )));
    }
    Ok(canon)
}

/// `canonicalize` on Windows returns `\\?\C:\...`. Drop the verbatim prefix for
/// plain drive paths so results match what the UI sends and displays. UNC and
/// other verbatim forms are left untouched.
fn strip_verbatim(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.as_os_str().to_string_lossy();
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            let b = rest.as_bytes();
            if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
                return PathBuf::from(rest);
            }
        }
    }
    p
}

/// Opens `path` as the workspace (`null` closes it). Switching folders stops
/// every run and terminal from the previous workspace. Returns the canonical
/// root, which the UI should use from then on.
#[tauri::command]
pub async fn set_workspace(
    app: AppHandle,
    path: Option<String>,
) -> Result<Option<String>, FsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<WorkspaceState>();
        let next = path.as_deref().map(canonical_workspace_dir).transpose()?;
        // Re-opening the same folder keeps its terminals and runs alive.
        if next != state.root() {
            app.state::<RunRegistry>().shutdown_all();
            app.state::<PtyManager>().shutdown_all();
            state.store(next.clone());
        }
        Ok(next.map(|p| p.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn verbatim_drive_prefix_is_stripped() {
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\C:\work\a.c")),
            PathBuf::from(r"C:\work\a.c")
        );
        assert_eq!(
            strip_verbatim(PathBuf::from(r"\\?\UNC\srv\share")),
            PathBuf::from(r"\\?\UNC\srv\share")
        );
    }

    #[test]
    fn relative_and_parent_paths_are_invalid() {
        let ws = WorkspaceState::default();
        assert!(matches!(
            ws.resolve("src/main.c"),
            Err(FsError::InvalidPath)
        ));
        let dir = tempfile::tempdir().unwrap();
        ws.set_root(Some(&dir.path().to_string_lossy())).unwrap();
        let sneaky = dir.path().join("..").join("x");
        assert!(matches!(
            ws.resolve(&sneaky.to_string_lossy()),
            Err(FsError::InvalidPath)
        ));
    }
}
