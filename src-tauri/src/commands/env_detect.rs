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
    purpose: &'static str,
    install_hint: &'static str,
}

const TOOLS: &[ToolSpec] = &[
    ToolSpec {
        name: "gcc",
        purpose: "Compiles C programs",
        install_hint: "sudo apt install build-essential",
    },
    ToolSpec {
        name: "g++",
        purpose: "Compiles C++ programs",
        install_hint: "sudo apt install build-essential",
    },
    ToolSpec {
        name: "python3",
        purpose: "Runs Python programs",
        install_hint: "sudo apt install python3",
    },
    ToolSpec {
        name: "javac",
        purpose: "Compiles Java programs",
        install_hint: "sudo apt install default-jdk",
    },
    ToolSpec {
        name: "java",
        purpose: "Runs compiled Java programs",
        install_hint: "sudo apt install default-jre",
    },
    ToolSpec {
        name: "sf",
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
            let path = which::which(spec.name)
                .ok()
                .map(|p| p.to_string_lossy().into_owned());
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
    let shell_path = which::which(&shell)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .or_else(|| std::path::Path::new(&shell).exists().then(|| shell.clone()));

    out.push(ToolStatus {
        name: "shell".to_string(),
        available: shell_path.is_some(),
        path: shell_path,
        purpose: "Powers the integrated terminal".to_string(),
        install_hint: "sudo apt install bash".to_string(),
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
