//! Toolchain detection so a missing compiler is a clear message, not a crash.

use serde::Serialize;

use crate::pty::default_shell;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub path: Option<String>,
    pub available: bool,
    /// What breaks without it, in student-facing words.
    pub purpose: String,
    /// Exact Ubuntu command that installs it.
    pub install_hint: String,
}

struct ToolSpec {
    name: &'static str,
    candidates: &'static [&'static str],
    purpose: &'static str,
    install_hint: &'static str,
}

const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: "python",
        candidates: &["python3", "python", "py"],
        purpose: "Runs Python programs",
        install_hint: "Install Python from python.org or via winget install Python.Python.3.12",
    },
    ToolSpec {
        name: "gcc",
        candidates: &["gcc", "clang", "cl"],
        purpose: "Compiles C programs",
        install_hint: "Install GCC or Clang (MinGW-w64 or Visual Studio Build Tools)",
    },
    ToolSpec {
        name: "g++",
        candidates: &["g++", "clang++"],
        purpose: "Compiles C++ programs",
        install_hint: "Install G++ or Clang++ (MinGW-w64 or Visual Studio Build Tools)",
    },
    ToolSpec {
        name: "rustc",
        candidates: &["rustc"],
        purpose: "Compiles Rust programs",
        install_hint: "Install Rust via rustup (https://rustup.rs)",
    },
    ToolSpec {
        name: "cargo",
        candidates: &["cargo"],
        purpose: "Rust package manager & build tool",
        install_hint: "Install Rust via rustup (https://rustup.rs)",
    },
    ToolSpec {
        name: "go",
        candidates: &["go"],
        purpose: "Compiles and runs Go programs",
        install_hint: "Install Go from https://go.dev",
    },
    ToolSpec {
        name: "javac",
        candidates: &["javac"],
        purpose: "Compiles Java programs",
        install_hint: "Install OpenJDK or Microsoft Build of OpenJDK",
    },
    ToolSpec {
        name: "java",
        candidates: &["java"],
        purpose: "Runs compiled Java programs",
        install_hint: "Install Java Runtime or JDK",
    },
    ToolSpec {
        name: "node",
        candidates: &["node", "nodejs"],
        purpose: "Runs JavaScript / TypeScript programs",
        install_hint: "Install Node.js from https://nodejs.org",
    },
    ToolSpec {
        name: "git",
        candidates: &["git"],
        purpose: "Git version control system",
        install_hint: "Install Git from https://git-scm.com",
    },
    ToolSpec {
        name: "zig",
        candidates: &["zig"],
        purpose: "Compiles and runs Zig programs",
        install_hint: "Install Zig from https://ziglang.org",
    },
    ToolSpec {
        name: "sf",
        candidates: &["sf"],
        purpose: "Compiles and runs Salivo programs",
        install_hint: "Install the Salivo toolchain, then add ~/.salivo/bin to your PATH",
    },
];

/// Resolves each tool on `$PATH`.
///
/// Deliberately does not run `--version`: a compiler that is installed but
/// misconfigured would exit non-zero and be reported as missing, sending the
/// student to reinstall something they already have.
#[tauri::command]
pub fn detect_tools() -> Vec<ToolStatus> {
    let mut out: Vec<ToolStatus> = TOOLS
        .iter()
        .map(|spec| {
<<<<<<< HEAD:CodeUI-main/src-tauri/src/commands/env_detect.rs
            let path = crate::proc::resolve_tool(spec.candidates)
                .map(|p| p.to_string_lossy().into_owned());
=======
            let path = spec.candidates.iter().find_map(|&cand| {
                which::which(cand)
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned())
            });
>>>>>>> 66b6de40caf85349a094aaf1377b064cfc6d6bf6:src-tauri/src/commands/env_detect.rs
            ToolStatus {
                name: spec.name.to_string(),
                available: path.is_some(),
                path,
                purpose: spec.purpose.to_string(),
                install_hint: spec.install_hint.to_string(),
            }
        })
        .collect();

    let shell = default_shell();
    let shell_path = crate::proc::resolve_tool(&[&shell])
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| std::path::Path::new(&shell).exists().then(|| shell.clone()));

    #[cfg(windows)]
    let shell_hint = "PowerShell or cmd.exe (built into Windows)".to_string();
    #[cfg(not(windows))]
    let shell_hint = "sudo apt install bash (or install zsh)".to_string();

    out.push(ToolStatus {
        name: "shell".to_string(),
        available: shell_path.is_some(),
        path: shell_path,
        purpose: "Powers the integrated terminal".to_string(),
        install_hint: shell_hint,
    });

    out
}

/// True when every required tool resolved; drives the startup banner.
#[tauri::command]
pub fn all_tools_available() -> bool {
    detect_tools().iter().all(|t| t.available)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_every_tool_with_a_hint() {
        let tools = detect_tools();
        assert_eq!(tools.len(), TOOLS.len() + 1);
        for tool in &tools {
            assert!(!tool.install_hint.is_empty(), "{} lacks a hint", tool.name);
            // available and path must agree, or the UI shows a green check with no path.
            assert_eq!(tool.available, tool.path.is_some(), "{}", tool.name);
        }
    }

    #[test]
    fn detection_never_panics_for_absent_tools() {
        // Runs on CI images with and without a JDK; the point is it returns.
        let _ = all_tools_available();
    }
}
