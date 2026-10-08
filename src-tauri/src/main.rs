// Keeps the console window from appearing alongside the GUI on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Run's exec phase re-executes this binary as a sandbox launcher; it must
    // never start the GUI.
    if let Some(code) = codeui_lib::proc::sandbox::launcher_main() {
        std::process::exit(code);
    }
    codeui_lib::run();
}
