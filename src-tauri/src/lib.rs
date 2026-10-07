//! CodeUI backend: filesystem, process execution, PTY, toolchain detection,
//! and settings persistence exposed over Tauri IPC.

pub mod commands;
pub mod proc;
pub mod pty;
pub mod runners;

use tauri::Manager;

use commands::process::RunRegistry;
use commands::settings::SettingsStore;
use pty::PtyManager;

/// Linux (WebKitGTK): the DMABUF renderer and accelerated compositing cause
/// stale repaints — Monaco's scroll layers move but the view is not redrawn
/// until the caret forces it, so wheel/scrollbar scrolling looks dead.
/// Must run before any webview is created. User-set values are respected.
#[cfg(target_os = "linux")]
fn apply_webkitgtk_workarounds() {
    for key in ["WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DISABLE_COMPOSITING_MODE"] {
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, "1");
        }
    }
}

pub fn run() {
    #[cfg(target_os = "linux")]
    apply_webkitgtk_workarounds();

    tauri::Builder::default()
        .setup(|app| {
            if let Ok(dir) = app.path().resource_dir() {
                let sdk = dir.join("resources").join("salivo-sdk");
                if sdk.join("bin").is_dir() {
                    proc::set_bundled_bin(sdk.join("bin"));
                }
                // Linux: the bundled sf links the libLLVM shipped next to it.
                // Children (Run, terminal) inherit this.
                #[cfg(target_os = "linux")]
                if sdk.join("lib").is_dir() {
                    let mut paths = vec![sdk.join("lib")];
                    if let Some(old) = std::env::var_os("LD_LIBRARY_PATH") {
                        paths.extend(std::env::split_paths(&old));
                    }
                    if let Ok(joined) = std::env::join_paths(paths) {
                        std::env::set_var("LD_LIBRARY_PATH", joined);
                    }
                }
            }
            Ok(())
        })
        .manage(RunRegistry::default())
        .manage(PtyManager::default())
        .manage(SettingsStore::load())
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::list_dir,
            commands::fs::create_file,
            commands::fs::create_dir,
            commands::fs::rename_file,
            commands::fs::delete_file,
            commands::fs::path_exists,
            commands::fs::pick_folder,
            commands::fs::pick_file,
            commands::fs::open_in_file_manager,
            commands::fs::search_files,
            commands::fs::find_files,
            commands::process::run_file,
            commands::process::stop_run,
            commands::process::write_run_stdin,
            commands::process::close_run_stdin,
            commands::terminal::spawn_pty,
            commands::terminal::write_pty,
            commands::terminal::resize_pty,
            commands::terminal::kill_pty,
            commands::terminal::list_pty_sessions,
            commands::terminal::get_default_shell,
            commands::env_detect::detect_tools,
            commands::env_detect::all_tools_available,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::flush_settings,
            commands::settings::settings_file_path,
            commands::diagnostics::get_diagnostics,
            commands::extensions::list_extensions,
            commands::extensions::install_extension,
            commands::extensions::uninstall_extension,
            commands::extensions::set_extension_enabled,
            commands::extensions::read_extension_file,
        ])
        .on_window_event(|window, event| {
            // Closing the window must not leave student processes or shells
            // running on a shared lab machine.
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                shutdown(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start CodeUI");
}

fn shutdown(app: &tauri::AppHandle) {
    app.state::<RunRegistry>().shutdown_all();
    app.state::<PtyManager>().shutdown_all();
    let _ = app.state::<SettingsStore>().flush();
}
