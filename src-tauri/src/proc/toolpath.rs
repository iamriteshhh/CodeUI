//! Toolpath augmentation and resolution logic.
//! Guarantees compilers and interpreters are discovered even when launched
//! from GUI desktop shortcuts with a stripped environment PATH.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::OnceLock;

static BUNDLED_BIN: OnceLock<PathBuf> = OnceLock::new();

/// Registers the `bin` folder of the Salivo SDK shipped inside the app bundle.
/// It goes first on PATH so the bundled compiler wins over older user installs.
pub fn set_bundled_bin(dir: PathBuf) {
    let _ = BUNDLED_BIN.set(dir);
}

/// `LANG` for programs started in a terminal, when the environment has no UTF-8 locale.
///
/// The terminal decodes UTF-8, but under `LANG=C` (or no locale at all, as on some lab
/// machines and minimal installs) Java and other programs print non-ASCII as `?`. Unix only:
/// on Windows the console code page decides, and forcing UTF-8 there would garble output.
pub fn utf8_locale_override() -> Option<&'static str> {
    #[cfg(unix)]
    {
        let is_utf8 = |key: &str| {
            std::env::var(key).is_ok_and(|v| {
                let v = v.to_ascii_lowercase();
                v.contains("utf-8") || v.contains("utf8")
            })
        };
        // LC_ALL wins over LANG; a set, non-UTF-8 LC_ALL would override our LANG anyway.
        if is_utf8("LC_ALL") || (std::env::var_os("LC_ALL").is_none() && is_utf8("LANG")) {
            return None;
        }
        Some("C.UTF-8")
    }
    #[cfg(not(unix))]
    {
        None
    }
}

/// Constructs an augmented PATH combining current PATH with standard toolchain locations.
pub fn augmented_path() -> OsString {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();

    #[cfg(unix)]
    {
        if let Ok(home) = std::env::var("HOME") {
            paths.push(PathBuf::from(&home).join(".local/bin"));
            paths.push(PathBuf::from(&home).join(".cargo/bin"));
            paths.push(PathBuf::from(&home).join(".salivo/bin"));
        }
        paths.push(PathBuf::from("/usr/local/bin"));
        paths.push(PathBuf::from("/usr/bin"));
        paths.push(PathBuf::from("/bin"));
        paths.push(PathBuf::from("/snap/bin"));
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            paths.push(PathBuf::from(java_home).join("bin"));
        }
    }

    #[cfg(windows)]
    {
        let common = [
            r"C:\msys64\ucrt64\bin",
            r"C:\msys64\mingw64\bin",
            r"C:\MinGW\bin",
            r"C:\Program Files\LLVM\bin",
            r"C:\Program Files\Git\bin",
            r"C:\Program Files\Git\usr\bin",
        ];
        for c in common {
            let p = PathBuf::from(c);
            if p.exists() {
                paths.push(p);
            }
        }
        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            paths.push(PathBuf::from(&user_profile).join(".cargo").join("bin"));
            paths.push(PathBuf::from(&user_profile).join(".salivo").join("bin"));
            paths.push(
                PathBuf::from(&user_profile)
                    .join("AppData")
                    .join("Local")
                    .join("Programs")
                    .join("Python"),
            );
        }
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            paths.push(PathBuf::from(java_home).join("bin"));
        }
    }

    if let Some(bundled) = BUNDLED_BIN.get() {
        paths.insert(0, bundled.clone());
    }

    std::env::join_paths(paths).unwrap_or_default()
}

/// Resolves a candidate tool name on the augmented PATH, skipping 0-byte WindowsApps redirectors.
pub fn resolve_tool(candidates: &[&str]) -> Option<PathBuf> {
    let path_env = augmented_path();
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for &cand in candidates {
        if let Ok(resolved) = which::which_in(cand, Some(&path_env), &cwd) {
            #[cfg(windows)]
            {
                // Skip 0-byte WindowsApps redirector stubs that open Microsoft Store
                let path_str = resolved.to_string_lossy().to_lowercase();
                if path_str.contains(r"\microsoft\windowsapps\") {
                    if let Ok(meta) = std::fs::metadata(&resolved) {
                        if meta.len() == 0 {
                            continue;
                        }
                    }
                }
            }
            return Some(resolved);
        }
    }
    None
}
