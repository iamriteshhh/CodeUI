//! Toolpath augmentation and resolution logic.
//! Guarantees compilers and interpreters are discovered even when launched
//! from GUI desktop shortcuts with a stripped environment PATH.

use std::ffi::OsString;
use std::path::PathBuf;

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
            paths.push(PathBuf::from(&user_profile).join("AppData").join("Local").join("Programs").join("Python"));
        }
        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            paths.push(PathBuf::from(java_home).join("bin"));
        }
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
