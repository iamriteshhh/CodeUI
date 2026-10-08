//! Diagnostics command providing environment and build context.

use serde::Serialize;
use tauri::State;

use crate::commands::env_detect::{detect_tools, fill_versions, ToolStatus};
use crate::commands::settings::SettingsStore;
use crate::proc::sandbox::SandboxStatus;
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
    /// PATH as student programs and compilers actually see it (toolchain
    /// folders appended, bundled SDK first).
    pub run_path_var: String,
    pub default_shell: String,
    pub resolved_shell: Option<String>,
    pub active_pty_sessions: Vec<String>,
    pub pty_session_count: usize,
    /// Each tool also carries `version` here (first line of `--version`).
    pub tools: Vec<ToolStatus>,
    /// What the OS enforces on a student program on this machine.
    pub sandbox: SandboxStatus,
    /// `version` from ai-policy.json, when the policy declares one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extension_policy_version: Option<String>,
}

/// Runs off the main thread: asking each toolchain for its version takes up
/// to a few seconds and must not freeze the window.
#[tauri::command(async)]
pub fn get_diagnostics(
    pty_manager: State<'_, PtyManager>,
    settings_store: State<'_, SettingsStore>,
) -> SystemDiagnostics {
    let shell = default_shell();
    let resolved_shell = which::which(&shell)
        .ok()
        .map(|p| p.to_string_lossy().into_owned());
    let mut tools = detect_tools();
    fill_versions(&mut tools);
    let sessions = pty_manager.session_ids();

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
        run_path_var: crate::proc::augmented_path().to_string_lossy().into_owned(),
        default_shell: shell,
        resolved_shell,
        pty_session_count: sessions.len(),
        active_pty_sessions: sessions,
        tools,
        sandbox: crate::proc::sandbox::status(),
        extension_policy_version: policy_version(include_str!("../../ai-policy.json")),
    }
}

/// Reads a top-level `"version"` (string or number) from the policy JSON.
fn policy_version(json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(json).ok()?;
    match value.get("version")? {
        serde_json::Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::policy_version;

    #[test]
    fn policy_version_is_optional() {
        assert_eq!(policy_version(r#"{"terms": []}"#), None);
        assert_eq!(policy_version(r#"{"version": "3"}"#).as_deref(), Some("3"));
        assert_eq!(policy_version(r#"{"version": 4}"#).as_deref(), Some("4"));
    }
}
