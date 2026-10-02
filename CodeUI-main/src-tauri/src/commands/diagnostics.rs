//! Diagnostics command providing environment and build context.

use serde::Serialize;
use tauri::State;

use crate::commands::env_detect::{detect_tools, ToolStatus};
use crate::commands::settings::SettingsStore;
use crate::pty::{default_shell, PtyManager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnostics {
    pub version: String,
    pub git_sha: String,
    pub build_time: String,
    pub profile: String,
    pub target_triple: String,
    pub os: String,
    pub arch: String,
    pub family: String,
    pub executable_path: Option<String>,
    pub current_dir: Option<String>,
    pub settings_path: String,
    pub path_var: String,
    pub default_shell: String,
    pub resolved_shell: Option<String>,
    pub active_pty_sessions: Vec<String>,
    pub tools: Vec<ToolStatus>,
}

#[tauri::command]
pub fn get_diagnostics(
    pty_manager: State<'_, PtyManager>,
    settings_store: State<'_, SettingsStore>,
) -> SystemDiagnostics {
    let shell = default_shell();
    let resolved_shell = which::which(&shell)
        .ok()
        .map(|p| p.to_string_lossy().into_owned());

    SystemDiagnostics {
        version: env!("CARGO_PKG_VERSION").to_string(),
        git_sha: env!("CODEUI_GIT_SHA").to_string(),
        build_time: env!("CODEUI_BUILD_TIME").to_string(),
        profile: env!("CODEUI_PROFILE").to_string(),
        target_triple: env!("CODEUI_TARGET").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        family: std::env::consts::FAMILY.to_string(),
        executable_path: std::env::current_exe()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        current_dir: std::env::current_dir()
            .ok()
            .map(|p| p.to_string_lossy().into_owned()),
        settings_path: settings_store.path(),
        path_var: std::env::var("PATH").unwrap_or_default(),
        default_shell: shell,
        resolved_shell,
        active_pty_sessions: pty_manager.session_ids(),
        tools: detect_tools(),
    }
}
