//! Security regression tests: every filesystem command is confined to the
//! open workspace, except for a file the student explicitly picked.

use std::path::{Path, PathBuf};

use codeui_lib::commands::fs::{
    create_dir_sync, create_file_sync, delete_file_sync, find_files_sync, list_dir_sync,
    read_file_sync, rename_file_sync, search_files_sync, write_file_sync, FsError,
};
use codeui_lib::commands::workspace::{resolve_in_workspace, WorkspaceState};

/// `<tmp>/ws` is the workspace; `<tmp>/outside` is a sibling it must not reach.
struct Fixture {
    _dir: tempfile::TempDir,
    ws_dir: PathBuf,
    outside: PathBuf,
    state: WorkspaceState,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let ws_dir = dir.path().join("ws");
    let outside = dir.path().join("outside");
    std::fs::create_dir_all(ws_dir.join("src")).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(ws_dir.join("src").join("main.c"), "int main(){}").unwrap();
    std::fs::write(outside.join("secret.txt"), "secret").unwrap();

    let state = WorkspaceState::default();
    state.set_root(Some(&s(&ws_dir))).expect("open workspace");
    Fixture {
        _dir: dir,
        ws_dir,
        outside,
        state,
    }
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn denied<T: std::fmt::Debug>(r: Result<T, FsError>) -> bool {
    matches!(r, Err(FsError::PermissionDenied(_)))
}

#[test]
fn files_inside_the_workspace_work() {
    let f = fixture();
    let main = f.ws_dir.join("src").join("main.c");
    assert_eq!(read_file_sync(&f.state, &s(&main)).unwrap(), "int main(){}");
    write_file_sync(&f.state, &s(&main), "x").unwrap();

    let listed = list_dir_sync(&f.state, &s(&f.ws_dir)).unwrap();
    assert_eq!(listed.len(), 1);
    // Paths come back in the form they were sent (no \\?\ prefix).
    assert_eq!(listed[0].path, s(&f.ws_dir.join("src")));
}

#[test]
fn set_workspace_returns_canonical_root_without_verbatim_prefix() {
    let f = fixture();
    let root = f.state.root().unwrap();
    assert!(
        !s(&root).starts_with(r"\\?\"),
        "leaked verbatim prefix: {root:?}"
    );
    assert_eq!(root, std::fs::canonicalize(&f.ws_dir).map(strip).unwrap());
}

fn strip(p: PathBuf) -> PathBuf {
    let text = s(&p);
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

#[test]
fn set_workspace_rejects_files_missing_paths_and_system_roots() {
    let f = fixture();
    let ws = WorkspaceState::default();
    let file = f.ws_dir.join("src").join("main.c");
    assert!(matches!(
        ws.set_root(Some(&s(&file))),
        Err(FsError::NotADirectory(_))
    ));
    assert!(matches!(
        ws.set_root(Some(&s(&f.ws_dir.join("nope")))),
        Err(FsError::NotFound(_))
    ));
    let system_root = if cfg!(windows) { r"C:\" } else { "/" };
    assert!(denied(ws.set_root(Some(system_root))));
    assert!(ws.root().is_none());
}

#[test]
fn dot_dot_traversal_is_rejected() {
    let f = fixture();
    let sneaky = f.ws_dir.join("..").join("outside").join("secret.txt");
    assert!(matches!(
        read_file_sync(&f.state, &s(&sneaky)),
        Err(FsError::InvalidPath)
    ));
    assert!(matches!(
        write_file_sync(&f.state, &s(&sneaky), "pwned"),
        Err(FsError::InvalidPath)
    ));
    assert_eq!(
        std::fs::read_to_string(f.outside.join("secret.txt")).unwrap(),
        "secret"
    );
}

#[test]
fn absolute_paths_outside_the_workspace_are_denied() {
    let f = fixture();
    let secret = f.outside.join("secret.txt");
    assert!(denied(read_file_sync(&f.state, &s(&secret))));
    assert!(denied(write_file_sync(&f.state, &s(&secret), "pwned")));
    assert!(denied(delete_file_sync(&f.state, &s(&secret))));
    assert!(denied(list_dir_sync(&f.state, &s(&f.outside))));
    assert!(denied(create_dir_sync(
        &f.state,
        &s(&f.outside.join("new"))
    )));
    assert!(denied(find_files_sync(&f.state, &s(&f.outside), "", 50)));
    assert!(denied(search_files_sync(
        &f.state,
        &s(&f.outside),
        "secret",
        false,
        50
    )));

    let system = if cfg!(windows) {
        r"C:\Windows\win.ini"
    } else {
        "/etc/passwd"
    };
    assert!(denied(read_file_sync(&f.state, system)));
    assert_eq!(
        std::fs::read_to_string(&secret).unwrap(),
        "secret",
        "nothing outside was touched"
    );
}

#[test]
fn rename_cannot_move_files_out_or_in() {
    let f = fixture();
    let main = f.ws_dir.join("src").join("main.c");
    let escaped = f.outside.join("main.c");
    assert!(denied(rename_file_sync(&f.state, &s(&main), &s(&escaped))));
    assert!(main.exists() && !escaped.exists());

    let secret = f.outside.join("secret.txt");
    let pulled_in = f.ws_dir.join("secret.txt");
    assert!(denied(rename_file_sync(
        &f.state,
        &s(&secret),
        &s(&pulled_in)
    )));
    assert!(secret.exists());

    // The workspace root itself cannot be renamed or deleted.
    assert!(denied(rename_file_sync(
        &f.state,
        &s(&f.ws_dir),
        &s(&f.ws_dir.with_file_name("ws2"))
    )));
    assert!(denied(delete_file_sync(&f.state, &s(&f.ws_dir))));
    assert!(f.ws_dir.exists());

    // Renames within the workspace still work.
    let renamed = f.ws_dir.join("src").join("app.c");
    rename_file_sync(&f.state, &s(&main), &s(&renamed)).unwrap();
    assert!(renamed.exists());
}

#[test]
fn nonexistent_targets_inside_are_allowed_outside_are_denied() {
    let f = fixture();
    let deep = f.ws_dir.join("new").join("deeper").join("file.py");
    create_file_sync(&f.state, &s(&deep)).unwrap();
    assert!(deep.is_file());
    create_dir_sync(&f.state, &s(&f.ws_dir.join("a").join("b"))).unwrap();
    assert!(f.ws_dir.join("a").join("b").is_dir());

    let outside_deep = f.outside.join("new").join("file.py");
    assert!(denied(create_file_sync(&f.state, &s(&outside_deep))));
    assert!(!f.outside.join("new").exists());

    let resolved = resolve_in_workspace(&f.state, &s(&f.ws_dir.join("ghost.c"))).unwrap();
    assert!(resolved.starts_with(f.state.root().unwrap()));
}

#[test]
fn no_workspace_means_nothing_is_reachable() {
    let f = fixture();
    let main = f.ws_dir.join("src").join("main.c");
    f.state.set_root(None).unwrap();
    assert!(denied(read_file_sync(&f.state, &s(&main))));
    assert!(denied(list_dir_sync(&f.state, &s(&f.ws_dir))));
    assert!(denied(write_file_sync(&f.state, &s(&main), "x")));
}

#[test]
fn allowlisted_external_file_is_usable_but_nothing_else() {
    let f = fixture();
    let secret = f.outside.join("secret.txt");
    f.state.allow_external(&secret).unwrap();

    assert_eq!(read_file_sync(&f.state, &s(&secret)).unwrap(), "secret");
    write_file_sync(&f.state, &s(&secret), "edited").unwrap();
    assert_eq!(std::fs::read_to_string(&secret).unwrap(), "edited");
    assert!(resolve_in_workspace(&f.state, &s(&secret)).is_ok());

    // Exact file only: its folder and siblings stay closed.
    std::fs::write(f.outside.join("other.txt"), "o").unwrap();
    assert!(denied(read_file_sync(
        &f.state,
        &s(&f.outside.join("other.txt"))
    )));
    assert!(denied(list_dir_sync(&f.state, &s(&f.outside))));
    // Editable, but not deletable or renamable.
    assert!(denied(delete_file_sync(&f.state, &s(&secret))));

    // Switching workspace clears the allowlist.
    f.state.set_root(Some(&s(&f.ws_dir))).unwrap();
    assert!(denied(read_file_sync(&f.state, &s(&secret))));

    // Directories cannot be allowlisted.
    assert!(f.state.allow_external(&f.outside).is_err());
}

/// Creates a directory symlink, or returns false where the OS refuses
/// (Windows without Developer Mode / admin).
fn symlink_dir(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(target, link).is_ok()
    }
}

fn symlink_file(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link).is_ok()
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }
}

#[test]
fn symlink_escape_is_denied() {
    let f = fixture();
    let link = f.ws_dir.join("escape");
    if !symlink_dir(&f.outside, &link) {
        eprintln!("skipping: cannot create symlinks here");
        return;
    }
    let through = link.join("secret.txt");
    assert!(denied(read_file_sync(&f.state, &s(&through))));
    assert!(denied(write_file_sync(&f.state, &s(&through), "pwned")));
    assert!(denied(list_dir_sync(&f.state, &s(&link))));
    assert!(denied(create_file_sync(
        &f.state,
        &s(&link.join("new.txt"))
    )));
    assert!(!f.outside.join("new.txt").exists());

    // The walk never follows the link out.
    let found = find_files_sync(&f.state, &s(&f.ws_dir), "secret", 50).unwrap();
    assert!(found.is_empty(), "walk followed a symlink: {found:?}");
    let hits = search_files_sync(&f.state, &s(&f.ws_dir), "secret", false, 50).unwrap();
    assert!(hits.is_empty(), "search followed a symlink: {hits:?}");

    // Deleting the link removes the link only, never what it points at.
    delete_file_sync(&f.state, &s(&link)).unwrap();
    assert_eq!(
        std::fs::read_to_string(f.outside.join("secret.txt")).unwrap(),
        "secret"
    );
}

#[test]
fn dangling_symlink_cannot_create_its_target() {
    let f = fixture();
    let target = f.outside.join("planted.txt");
    let link = f.ws_dir.join("planted.txt");
    if !symlink_file(&target, &link) {
        eprintln!("skipping: cannot create symlinks here");
        return;
    }
    assert!(create_file_sync(&f.state, &s(&link)).is_err());
    assert!(write_file_sync(&f.state, &s(&link), "pwned").is_err());
    assert!(!target.exists(), "write followed a dangling symlink out");
}

#[test]
fn relative_paths_are_rejected() {
    let f = fixture();
    assert!(matches!(
        read_file_sync(&f.state, "src/main.c"),
        Err(FsError::InvalidPath)
    ));
}
