//! Filesystem commands. Each maps 1:1 to a typed wrapper in `src/services/fsService.ts`.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
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

/// Rejects empty paths before they reach the OS.
fn validate(path: &str) -> Result<PathBuf, FsError> {
    if path.trim().is_empty() {
        return Err(FsError::InvalidPath);
    }
    Ok(PathBuf::from(path))
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, FsError> {
    let p = validate(&path)?;
    std::fs::read_to_string(&p).map_err(|e| FsError::from_io(e, &p))
}

/// Saves a file without ever leaving it half-written.
///
/// Writes a sibling temporary file and renames it over the original, so a crash
/// or power cut during save cannot truncate the student's source. The temp file
/// is a sibling rather than in /tmp so the rename stays within one filesystem.
#[tauri::command]
pub fn write_file(path: String, contents: String) -> Result<(), FsError> {
    let p = validate(&path)?;
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

    let tmp = parent.join(format!(".{name}.codeui-tmp"));
    std::fs::write(&tmp, contents).map_err(|e| FsError::from_io(e, &tmp))?;

    // The temp file is created fresh, so carry the original's mode across.
    if let Some(meta) = existing {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }

    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        FsError::from_io(e, &p)
    })
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<FileEntry>, FsError> {
    let p = validate(&path)?;
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
            path: entry.path().to_string_lossy().into_owned(),
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
pub fn create_file(path: String) -> Result<(), FsError> {
    let p = validate(&path)?;
    if p.exists() {
        return Err(FsError::AlreadyExists(p.display().to_string()));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| FsError::from_io(e, parent))?;
    }
    std::fs::write(&p, "").map_err(|e| FsError::from_io(e, &p))
}

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), FsError> {
    let p = validate(&path)?;
    if p.exists() {
        return Err(FsError::AlreadyExists(p.display().to_string()));
    }
    std::fs::create_dir_all(&p).map_err(|e| FsError::from_io(e, &p))
}

#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), FsError> {
    let from = validate(&old_path)?;
    let to = validate(&new_path)?;
    if !from.exists() {
        return Err(FsError::NotFound(from.display().to_string()));
    }
    // rename() would silently clobber an existing target.
    if to.exists() {
        return Err(FsError::AlreadyExists(to.display().to_string()));
    }
    std::fs::rename(&from, &to).map_err(|e| FsError::from_io(e, &from))
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<(), FsError> {
    let p = validate(&path)?;
    let meta = std::fs::symlink_metadata(&p).map_err(|e| FsError::from_io(e, &p))?;
    if meta.is_dir() {
        std::fs::remove_dir_all(&p).map_err(|e| FsError::from_io(e, &p))
    } else {
        std::fs::remove_file(&p).map_err(|e| FsError::from_io(e, &p))
    }
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    !path.trim().is_empty() && Path::new(&path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().expect("tempdir")
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
}
