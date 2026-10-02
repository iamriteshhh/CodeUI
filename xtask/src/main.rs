//! Build automation for CodeUI. Rust only - this repository ships no Python tooling.
//!
//! Usage:
//!   cargo run -p xtask -- version-sync
//!   cargo run -p xtask -- bump <version>
//!   cargo run -p xtask -- audit-no-python

use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let task = args.first().map(String::as_str).unwrap_or("help");

    let result = match task {
        "version-sync" => version_sync(None),
        "bump" => match args.get(1) {
            Some(v) => version_sync(Some(v.clone())),
            None => Err("usage: cargo run -p xtask -- bump <version>".into()),
        },
        "audit-no-python" => audit_no_python(),
        "check-conflicts" => check_conflicts(),
        _ => {
            print_help();
            Ok(())
        }
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("xtask: {e}");
            ExitCode::FAILURE
        }
    }
}

fn print_help() {
    println!("CodeUI build tasks:");
    println!("  version-sync       Align package.json and tauri.conf.json with Cargo.toml");
    println!("  bump <version>     Set the workspace version everywhere");
    println!("  audit-no-python    Fail if any .py file is tracked in the repository");
    println!("  check-conflicts    Fail if any merge conflict markers exist in source files");
}

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is <root>/xtask.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask has a parent directory")
        .to_path_buf()
}

type Task = Result<(), Box<dyn std::error::Error>>;

/// Makes Cargo.toml the single source of truth for the version number.
fn version_sync(new_version: Option<String>) -> Task {
    let root = repo_root();
    let cargo_path = root.join("Cargo.toml");
    let cargo_toml = std::fs::read_to_string(&cargo_path)?;

    let version = match new_version {
        Some(v) => {
            let updated = replace_workspace_version(&cargo_toml, &v)?;
            std::fs::write(&cargo_path, updated)?;
            println!("Cargo.toml -> {v}");
            v
        }
        None => read_workspace_version(&cargo_toml)?,
    };

    sync_json_version(&root.join("package.json"), &version)?;
    sync_json_version(&root.join("src-tauri").join("tauri.conf.json"), &version)?;

    println!("All manifests at version {version}");
    Ok(())
}

fn read_workspace_version(cargo_toml: &str) -> Result<String, Box<dyn std::error::Error>> {
    // Minimal parse: the workspace version is the first `version = "..."` under
    // [workspace.package]. Avoids pulling in a TOML dependency for one field.
    let section = cargo_toml
        .split("[workspace.package]")
        .nth(1)
        .ok_or("Cargo.toml has no [workspace.package] section")?;

    for line in section.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            break;
        }
        if let Some(rest) = line.strip_prefix("version") {
            if let Some(v) = rest.split('"').nth(1) {
                return Ok(v.to_string());
            }
        }
    }
    Err("no version found under [workspace.package]".into())
}

fn replace_workspace_version(
    cargo_toml: &str,
    new_version: &str,
) -> Result<String, Box<dyn std::error::Error>> {
    let current = read_workspace_version(cargo_toml)?;
    let needle = format!("version = \"{current}\"");
    let replacement = format!("version = \"{new_version}\"");
    Ok(cargo_toml.replacen(&needle, &replacement, 1))
}

fn sync_json_version(path: &Path, version: &str) -> Task {
    if !path.exists() {
        println!("skipped {} (not present yet)", path.display());
        return Ok(());
    }

    let raw = std::fs::read_to_string(path)?;
    let mut json: serde_json::Value = serde_json::from_str(&raw)?;
    json["version"] = serde_json::Value::String(version.to_string());

    let mut out = serde_json::to_string_pretty(&json)?;
    out.push('\n');
    std::fs::write(path, out)?;
    println!("{} -> {version}", path.display());
    Ok(())
}

/// Enforces the no-Python-tooling rule across the whole tree.
fn audit_no_python() -> Task {
    let root = repo_root();
    let mut offenders = Vec::new();
    scan_for_python(&root, &mut offenders)?;

    if offenders.is_empty() {
        println!("No .py files found. Repository is clean.");
        return Ok(());
    }

    for path in &offenders {
        eprintln!("  forbidden: {}", path.display());
    }
    Err(format!(
        "{} Python file(s) present in the repository",
        offenders.len()
    )
    .into())
}

fn scan_for_python(dir: &Path, out: &mut Vec<PathBuf>) -> Task {
    const SKIP: [&str; 5] = ["target", "node_modules", ".git", "dist", ".venv"];

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if path.is_dir() {
            if !SKIP.contains(&name.as_str()) {
                scan_for_python(&path, out)?;
            }
        } else if path.extension().is_some_and(|e| e == "py") {
            out.push(path);
        }
    }
    Ok(())
}

fn check_conflicts() -> Task {
    let root = repo_root();
    let mut offenders = Vec::new();
    scan_for_conflicts(&root, &mut offenders)?;

    if offenders.is_empty() {
        println!("No merge conflict markers found. Repository is clean.");
        return Ok(());
    }

    for (path, line_num, marker) in &offenders {
        eprintln!("  conflict: {}:{}: {}", path.display(), line_num, marker);
    }
    Err(format!(
        "{} merge conflict marker(s) found in repository",
        offenders.len()
    )
    .into())
}

fn scan_for_conflicts(dir: &Path, out: &mut Vec<(PathBuf, usize, String)>) -> Task {
    const SKIP_DIRS: [&str; 6] = ["target", "node_modules", ".git", "dist", ".venv", "artifacts"];
    const SKIP_EXTENSIONS: [&str; 4] = ["md", "png", "ttf", "exe"];

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if path.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                scan_for_conflicts(&path, out)?;
            }
        } else {
            if let Some(ext) = path.extension() {
                if SKIP_EXTENSIONS.contains(&ext.to_string_lossy().as_ref()) {
                    continue;
                }
            }
            if let Ok(content) = std::fs::read_to_string(&path) {
                for (idx, line) in content.lines().enumerate() {
                    let trimmed = line.trim_start();
                    if trimmed.starts_with("<<<<<<< ")
                        || trimmed == "======="
                        || trimmed.starts_with(">>>>>>> ")
                    {
                        out.push((path.clone(), idx + 1, trimmed.to_string()));
                    }
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "[workspace]\nmembers = [\"a\"]\n\n[workspace.package]\nversion = \"0.1.0\"\nedition = \"2021\"\n";

    #[test]
    fn reads_workspace_version() {
        assert_eq!(read_workspace_version(SAMPLE).unwrap(), "0.1.0");
    }

    #[test]
    fn replaces_only_the_workspace_version() {
        let updated = replace_workspace_version(SAMPLE, "0.2.0").unwrap();
        assert_eq!(read_workspace_version(&updated).unwrap(), "0.2.0");
        assert!(updated.contains("edition = \"2021\""));
    }

    #[test]
    fn errors_without_a_workspace_package_section() {
        assert!(read_workspace_version("[package]\nversion = \"9.9.9\"").is_err());
    }
}
