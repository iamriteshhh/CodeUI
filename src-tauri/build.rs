fn main() {
    let git_sha = std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "0.1.0".to_string());

    let build_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    println!("cargo:rustc-env=CODEUI_GIT_SHA={}", git_sha);
    println!("cargo:rustc-env=CODEUI_BUILD_TIME={}", build_time);
    println!(
        "cargo:rustc-env=CODEUI_PROFILE={}",
        std::env::var("PROFILE").unwrap_or_else(|_| "debug".to_string())
    );
    println!(
        "cargo:rustc-env=CODEUI_TARGET={}",
        std::env::var("TARGET").unwrap_or_default()
    );

    tauri_build::build();
}
