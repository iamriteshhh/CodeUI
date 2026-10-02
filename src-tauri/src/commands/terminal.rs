//! Terminal IPC surface. Pairs 1:1 with `src/services/ptyService.ts`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::pty::{default_shell, PtyError, PtyManager, PtySpawnOptions};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyDataEvent {
    pub session_id: String,
    pub data: String,
}

#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    session_id: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<String, PtyError> {
    let app_data = app.clone();
    let app_exit = app.clone();

    // Use caller-provided ID if available so frontend can subscribe before spawning
    let id = session_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let id_for_data = id.clone();
    let id_for_exit = id.clone();

    manager.spawn(
        PtySpawnOptions {
            id: id.clone(),
            shell,
            cwd,
            cols: cols.unwrap_or(80),
            rows: rows.unwrap_or(24),
        },
        move |data| {
            let _ = app_data.emit(
                &format!("pty-data-{id_for_data}"),
                PtyDataEvent {
                    session_id: id_for_data.clone(),
                    data,
                },
            );
        },
        move || {
            let _ = app_exit.emit(&format!("pty-exit-{id_for_exit}"), id_for_exit.clone());
        },
    )
}

#[tauri::command]
pub fn write_pty(
    manager: State<'_, PtyManager>,
    session_id: String,
    data: String,
) -> Result<(), PtyError> {
    manager.write(&session_id, &data)
}

#[tauri::command]
pub fn resize_pty(
    manager: State<'_, PtyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), PtyError> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn kill_pty(manager: State<'_, PtyManager>, session_id: String) -> Result<(), PtyError> {
    manager.kill(&session_id)
}

#[tauri::command]
pub fn list_pty_sessions(manager: State<'_, PtyManager>) -> Vec<String> {
    manager.session_ids()
}

#[tauri::command]
pub fn get_default_shell() -> String {
    default_shell()
}
