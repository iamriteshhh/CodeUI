//! Real extension installs from Open VSX, limited to what CodeUI can honour without an
//! extension host: syntax grammars, language configuration and colour themes.
//!
//! Extension code (`main`/`browser`), snippets and everything else in the VSIX is never
//! written to disk. AI extensions are refused here, not just hidden in the UI.

use std::collections::BTreeSet;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const OPEN_VSX: &str = "https://open-vsx.org/api";
const MAX_VSIX_BYTES: u64 = 150 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const STATE_FILE: &str = ".state.json";

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum ExtError {
    #[error("Blocked by lab policy: {0}")]
    Blocked(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Download failed: {0}")]
    Network(String),
    #[error("{0}")]
    Io(String),
}

impl From<std::io::Error> for ExtError {
    fn from(e: std::io::Error) -> Self {
        ExtError::Io(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// AI policy (shared with the UI through ai-policy.json)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    terms: Vec<String>,
    prefixes: Vec<String>,
    blocked_ids: Vec<String>,
    manifest_keys: Vec<String>,
    api_proposal_prefixes: Vec<String>,
    activation_event_prefixes: Vec<String>,
}

fn policy() -> &'static Policy {
    static POLICY: OnceLock<Policy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("../../ai-policy.json")).expect("ai-policy.json is valid")
    })
}

/// Lowercase words separated by single spaces, padded so `contains(" term ")` is a
/// whole-word match. Must stay identical to `normalize` in src/services/aiPolicy.ts.
fn normalize(text: &str) -> String {
    let mut out = String::from(" ");
    for c in text.chars() {
        if c.is_alphanumeric() {
            out.extend(c.to_lowercase());
        } else if !out.ends_with(' ') {
            out.push(' ');
        }
    }
    if !out.ends_with(' ') {
        out.push(' ');
    }
    out
}

/// Why `id` + free text identify an AI extension, if they do.
pub fn ai_block_reason(id: &str, text: &str) -> Option<String> {
    let p = policy();
    let id_lower = id.to_lowercase();
    if p.blocked_ids.contains(&id_lower) {
        return Some(format!("{id} is an AI extension"));
    }
    let norm = normalize(&format!("{id} {text}"));
    if let Some(t) = p.terms.iter().find(|t| norm.contains(&normalize(t))) {
        return Some(format!("AI-related (\"{t}\")"));
    }
    if let Some(pre) = p
        .prefixes
        .iter()
        .find(|pre| norm.split(' ').any(|w| w.starts_with(pre.as_str())))
    {
        return Some(format!("AI-related (\"{pre}\")"));
    }
    None
}

fn strings_in(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(a) => a.iter().flat_map(strings_in).collect(),
        _ => Vec::new(),
    }
}

/// Inspects the VSIX manifest itself, so a harmless-looking listing cannot smuggle in
/// chat participants, language-model tools or AI-only API proposals.
fn manifest_block_reason(id: &str, m: &Value) -> Option<String> {
    let p = policy();
    if let Some(contributes) = m.get("contributes").and_then(Value::as_object) {
        if let Some(k) = p
            .manifest_keys
            .iter()
            .find(|k| contributes.contains_key(k.as_str()))
        {
            return Some(format!("contributes \"{k}\""));
        }
    }
    let lower = |key: &str| -> Vec<String> {
        strings_in(m.get(key).unwrap_or(&Value::Null))
            .into_iter()
            .map(|s| s.to_lowercase())
            .collect()
    };
    if let Some(a) = lower("enabledApiProposals").into_iter().find(|a| {
        p.api_proposal_prefixes
            .iter()
            .any(|pre| a.starts_with(pre.as_str()))
    }) {
        return Some(format!("uses API proposal \"{a}\""));
    }
    if let Some(e) = lower("activationEvents").into_iter().find(|e| {
        p.activation_event_prefixes
            .iter()
            .any(|pre| e.starts_with(pre.as_str()))
    }) {
        return Some(format!("activates on \"{e}\""));
    }
    for dep in lower("extensionDependencies")
        .into_iter()
        .chain(lower("extensionPack"))
    {
        if let Some(r) = ai_block_reason(&dep, "") {
            return Some(format!("depends on {dep}: {r}"));
        }
    }
    let text: Vec<String> = ["displayName", "description", "keywords", "categories"]
        .iter()
        .flat_map(|k| strings_in(m.get(*k).unwrap_or(&Value::Null)))
        .collect();
    ai_block_reason(id, &text.join(" "))
}

// ---------------------------------------------------------------------------
// Locations and state
// ---------------------------------------------------------------------------

fn valid_id(id: &str) -> Result<(String, String), ExtError> {
    let ok = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    match id.split_once('.') {
        Some((ns, name)) if ok(ns) && ok(name) => Ok((ns.to_string(), name.to_string())),
        _ => Err(ExtError::Invalid(format!("invalid extension id: {id}"))),
    }
}

fn user_dir(app: &AppHandle) -> Result<PathBuf, ExtError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| ExtError::Io(e.to_string()))?
        .join("extensions");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn builtin_dir(app: &AppHandle) -> Option<PathBuf> {
    let dir = app
        .path()
        .resource_dir()
        .ok()?
        .join("resources")
        .join("extensions");
    dir.is_dir().then_some(dir)
}

fn ext_dir(app: &AppHandle, id: &str) -> Result<(PathBuf, bool), ExtError> {
    let id = id.to_lowercase();
    valid_id(&id)?;
    let user = user_dir(app)?.join(&id);
    if user.join("package.json").is_file() {
        return Ok((user, false));
    }
    if let Some(b) = builtin_dir(app).map(|d| d.join(&id)) {
        if b.join("package.json").is_file() {
            return Ok((b, true));
        }
    }
    Err(ExtError::Invalid(format!("{id} is not installed")))
}

#[derive(Default, Serialize, Deserialize)]
struct State {
    disabled: BTreeSet<String>,
}

fn load_state(dir: &Path) -> State {
    std::fs::read_to_string(dir.join(STATE_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(dir: &Path, state: &State) -> Result<(), ExtError> {
    let json = serde_json::to_string_pretty(state).map_err(|e| ExtError::Io(e.to_string()))?;
    std::fs::write(dir.join(STATE_FILE), json)?;
    Ok(())
}

/// Rejects absolute paths and `..` so a manifest cannot point outside its folder.
fn safe_rel(rel: &str) -> Option<PathBuf> {
    let p = Path::new(rel.trim_start_matches("./"));
    p.components()
        .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
        .then(|| p.to_path_buf())
        .filter(|p| !p.as_os_str().is_empty())
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    pub id: String,
    pub version: String,
    pub display_name: String,
    pub publisher: String,
    pub description: String,
    pub builtin: bool,
    pub enabled: bool,
    /// Only the parts CodeUI loads: languages, grammars, themes.
    pub contributes: Value,
    /// True when the publisher's package ships code CodeUI does not run.
    pub has_code: bool,
}

fn describe(dir: &Path, builtin: bool, state: &State) -> Option<InstalledExtension> {
    let m: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("package.json")).ok()?).ok()?;
    let id = format!(
        "{}.{}",
        m["publisher"].as_str().unwrap_or_default(),
        m["name"].as_str().unwrap_or_default()
    )
    .to_lowercase();
    let c = &m["contributes"];
    Some(InstalledExtension {
        enabled: !state.disabled.contains(&id),
        display_name: m["displayName"].as_str().unwrap_or(&id).to_string(),
        publisher: m["publisher"].as_str().unwrap_or_default().to_string(),
        description: m["description"].as_str().unwrap_or_default().to_string(),
        version: m["version"].as_str().unwrap_or_default().to_string(),
        contributes: serde_json::json!({
            "languages": c["languages"].clone(),
            "grammars": c["grammars"].clone(),
            "themes": c["themes"].clone(),
        }),
        has_code: m
            .get("codeuiHadCode")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        builtin,
        id,
    })
}

fn list_blocking(app: &AppHandle) -> Vec<InstalledExtension> {
    let state = user_dir(app).map(|d| load_state(&d)).unwrap_or_default();
    let mut out: Vec<InstalledExtension> = Vec::new();
    let mut scan = |root: Option<PathBuf>, builtin: bool| {
        let Some(root) = root else { return };
        let Ok(entries) = std::fs::read_dir(root) else {
            return;
        };
        for e in entries.flatten() {
            if let Some(x) = describe(&e.path(), builtin, &state) {
                // A user install of the same id overrides the bundled copy.
                if !out.iter().any(|o| o.id == x.id) {
                    out.push(x);
                }
            }
        }
    };
    scan(user_dir(app).ok(), false);
    scan(builtin_dir(app), true);
    out.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    out
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

fn http_get(url: &str) -> Result<ureq::Response, ExtError> {
    if !url.starts_with("https://open-vsx.org/") {
        return Err(ExtError::Invalid(format!("refusing download from {url}")));
    }
    ureq::get(url)
        .set("User-Agent", "CodeUI")
        .timeout(std::time::Duration::from_secs(60))
        .call()
        .map_err(|e| ExtError::Network(e.to_string()))
}

fn read_capped(r: impl Read, cap: u64) -> Result<Vec<u8>, ExtError> {
    let mut buf = Vec::new();
    r.take(cap + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > cap {
        return Err(ExtError::Invalid("file is too large".into()));
    }
    Ok(buf)
}

/// Theme files may `"include"` a base theme; follow those too (one string scan, JSONC-safe enough).
fn theme_includes(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("\"include\"") {
        rest = &rest[i + 9..];
        let after = rest.trim_start();
        if let Some(v) = after.strip_prefix(':') {
            let v = v.trim_start();
            if let Some(v) = v.strip_prefix('"') {
                if let Some(end) = v.find('"') {
                    out.push(v[..end].to_string());
                }
            }
        }
    }
    out
}

fn install_blocking(app: &AppHandle, id: &str) -> Result<InstalledExtension, ExtError> {
    install_into(&user_dir(app)?, id)
}

fn install_into(root: &Path, id: &str) -> Result<InstalledExtension, ExtError> {
    let id = id.to_lowercase();
    let (ns, name) = valid_id(&id)?;
    if let Some(r) = ai_block_reason(&id, "") {
        return Err(ExtError::Blocked(r));
    }

    let meta: Value = http_get(&format!("{OPEN_VSX}/{ns}/{name}"))?
        .into_json()
        .map_err(|e| ExtError::Network(e.to_string()))?;
    let listing: Vec<String> = [
        "displayName",
        "description",
        "categories",
        "tags",
        "namespace",
    ]
    .iter()
    .flat_map(|k| strings_in(&meta[*k]))
    .collect();
    if let Some(r) = ai_block_reason(&id, &listing.join(" ")) {
        return Err(ExtError::Blocked(r));
    }
    let url = meta["files"]["download"]
        .as_str()
        .ok_or_else(|| ExtError::Invalid(format!("{id} has no downloadable package")))?;
    let vsix = read_capped(http_get(url)?.into_reader(), MAX_VSIX_BYTES)?;
    let mut zip =
        zip::ZipArchive::new(Cursor::new(vsix)).map_err(|e| ExtError::Invalid(e.to_string()))?;

    let entry = |zip: &mut zip::ZipArchive<Cursor<Vec<u8>>>, rel: &Path| -> Option<Vec<u8>> {
        let name = format!("extension/{}", rel.to_string_lossy().replace('\\', "/"));
        let f = zip.by_name(&name).ok()?;
        read_capped(f, MAX_FILE_BYTES).ok()
    };

    let raw = entry(&mut zip, Path::new("package.json"))
        .ok_or_else(|| ExtError::Invalid("package has no package.json".into()))?;
    let mut manifest: Value =
        serde_json::from_slice(&raw).map_err(|e| ExtError::Invalid(e.to_string()))?;
    if let Some(r) = manifest_block_reason(&id, &manifest) {
        return Err(ExtError::Blocked(r));
    }

    // Collect only declarative files the editor uses.
    let c = manifest["contributes"].clone();
    let mut wanted: Vec<PathBuf> = Vec::new();
    let mut push = |v: &Value| {
        if let Some(p) = v.as_str().and_then(safe_rel) {
            wanted.push(p);
        }
    };
    for l in c["languages"].as_array().into_iter().flatten() {
        push(&l["configuration"]);
    }
    for g in c["grammars"].as_array().into_iter().flatten() {
        push(&g["path"]);
    }
    push(&manifest["icon"]);
    let mut theme_files: Vec<PathBuf> = c["themes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| t["path"].as_str().and_then(safe_rel))
        .collect();
    wanted.extend(theme_files.iter().cloned());

    let tmp = root.join(format!("{id}.partial"));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)?;

    let mut i = 0;
    while i < wanted.len() {
        let rel = wanted[i].clone();
        i += 1;
        let Some(bytes) = entry(&mut zip, &rel) else {
            continue;
        };
        // Theme files (and the base themes they include) may include further themes.
        if theme_files.contains(&rel) {
            let base = rel.parent().unwrap_or(Path::new(""));
            for inc in theme_includes(&String::from_utf8_lossy(&bytes)) {
                if let Some(p) = safe_rel(&base.join(&inc).to_string_lossy()) {
                    if !wanted.contains(&p) && wanted.len() < 64 {
                        wanted.push(p.clone());
                        theme_files.push(p);
                    }
                }
            }
        }
        let dest = tmp.join(&rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(dest, bytes)?;
    }
    if let Some(readme) = (0..zip.len()).find(|&n| {
        zip.by_index(n)
            .map(|f| f.name().eq_ignore_ascii_case("extension/readme.md"))
            .unwrap_or(false)
    }) {
        if let Ok(f) = zip.by_index(readme) {
            if let Ok(bytes) = read_capped(f, MAX_FILE_BYTES) {
                std::fs::write(tmp.join("README.md"), bytes)?;
            }
        }
    }

    // Keep the manifest minimal: nothing that could later be mistaken for runnable code.
    let had_code = manifest.get("main").is_some() || manifest.get("browser").is_some();
    if let Some(obj) = manifest.as_object_mut() {
        for k in [
            "main",
            "browser",
            "activationEvents",
            "scripts",
            "dependencies",
            "devDependencies",
        ] {
            obj.remove(k);
        }
        obj.insert("codeuiHadCode".into(), Value::Bool(had_code));
        obj.insert(
            "contributes".into(),
            serde_json::json!({ "languages": c["languages"], "grammars": c["grammars"], "themes": c["themes"] }),
        );
    }
    std::fs::write(
        tmp.join("package.json"),
        serde_json::to_vec_pretty(&manifest).map_err(|e| ExtError::Io(e.to_string()))?,
    )?;

    let dest = root.join(&id);
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&tmp, &dest)?;

    let mut state = load_state(root);
    state.disabled.remove(&id);
    save_state(root, &state)?;
    describe(&dest, false, &state)
        .ok_or_else(|| ExtError::Invalid("installed package is unreadable".into()))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, ExtError> + Send + 'static,
) -> Result<T, ExtError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| ExtError::Io(e.to_string()))?
}

#[tauri::command]
pub async fn list_extensions(app: AppHandle) -> Result<Vec<InstalledExtension>, ExtError> {
    blocking(move || Ok(list_blocking(&app))).await
}

#[tauri::command]
pub async fn install_extension(app: AppHandle, id: String) -> Result<InstalledExtension, ExtError> {
    blocking(move || install_blocking(&app, &id)).await
}

#[tauri::command]
pub async fn uninstall_extension(app: AppHandle, id: String) -> Result<(), ExtError> {
    blocking(move || {
        let (dir, builtin) = ext_dir(&app, &id)?;
        if builtin {
            return Err(ExtError::Invalid(
                "built-in extensions can be disabled, not uninstalled".into(),
            ));
        }
        std::fs::remove_dir_all(dir)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_extension_enabled(
    app: AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), ExtError> {
    blocking(move || {
        ext_dir(&app, &id)?;
        let dir = user_dir(&app)?;
        let mut state = load_state(&dir);
        let id = id.to_lowercase();
        if enabled {
            state.disabled.remove(&id);
        } else {
            state.disabled.insert(id);
        }
        save_state(&dir, &state)
    })
    .await
}

/// Reads a text file (grammar, configuration, theme, README) from an installed extension.
#[tauri::command]
pub async fn read_extension_file(
    app: AppHandle,
    id: String,
    path: String,
) -> Result<String, ExtError> {
    blocking(move || {
        let (dir, _) = ext_dir(&app, &id)?;
        let rel =
            safe_rel(&path).ok_or_else(|| ExtError::Invalid(format!("invalid path {path}")))?;
        Ok(std::fs::read_to_string(dir.join(rel))?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_ai_by_id_text_and_manifest() {
        assert!(ai_block_reason("github.copilot", "").is_some());
        assert!(ai_block_reason("foo.bar", "An AI-powered helper").is_some());
        assert!(ai_block_reason("foo.bar", "Uses GPT-4o for answers").is_some());
        assert!(ai_block_reason("tabnine.whatever", "AI code completion for Rust").is_some());
        assert!(ai_block_reason("foo.bar", "Copilot-style inline suggestions").is_some());
        // A language server that mentions autocomplete is not AI
        assert!(ai_block_reason("meta.pyrefly", "Python autocomplete, typechecking, code navigation and more! Powered by Pyrefly, an open-source language server").is_none());
        let m = serde_json::json!({ "contributes": { "chatParticipants": [] } });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
        let m = serde_json::json!({ "enabledApiProposals": ["chatParticipantPrivate"] });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
        let m = serde_json::json!({ "contributes": { "languageModelChatProviders": [] } });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
        let m = serde_json::json!({ "extensionDependencies": ["GitHub.copilot-chat"] });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
    }

    #[test]
    fn allows_ordinary_extensions() {
        assert!(ai_block_reason(
            "ziglang.vscode-zig",
            "Language support for the Zig programming language"
        )
        .is_none());
        assert!(ai_block_reason(
            "dracula-theme.theme-dracula",
            "Official Dracula Theme. A dark theme for many editors"
        )
        .is_none());
        // "ai" must match whole words only
        assert!(ai_block_reason("foo.bar", "Maintains a chain of trailing commas").is_none());
    }

    /// Ordinary language extensions now ship optional hooks for AI tools. CodeUI never runs
    /// extension code, so those hooks are inert and must not get Python & co. blocked.
    #[test]
    fn allows_language_extensions_with_ai_tool_hooks() {
        let listing = "Python language support with extension access points for IntelliSense \
                       (Pylance), Debugging (Python Debugger), linting, formatting, refactoring, \
                       unit tests, and more. Programming Languages Debuggers Other Data Science \
                       Machine Learning";
        assert_eq!(ai_block_reason("ms-python.python", listing), None);
        let m = serde_json::json!({
            "displayName": "Python",
            "keywords": ["python", "django", "unittest", "multi-root ready"],
            "contributes": { "languageModelTools": [], "grammars": [] },
            "enabledApiProposals": ["codeActionAI", "terminalDataWriteEvent"],
            "activationEvents": ["onLanguageModelTool:install_python_packages"],
            "extensionPack": ["ms-python.vscode-pylance", "ms-python.debugpy"]
        });
        assert_eq!(manifest_block_reason("ms-python.python", &m), None);
    }

    /// Real download from Open VSX: `cargo test -- --ignored installs_a_real_theme`
    #[test]
    #[ignore]
    fn installs_a_real_theme_and_refuses_ai() {
        let root = tempfile::tempdir().unwrap();
        let ext = install_into(root.path(), "dracula-theme.theme-dracula").unwrap();
        assert_eq!(ext.contributes["themes"].as_array().unwrap().len(), 2);
        let dir = root.path().join("dracula-theme.theme-dracula");
        assert!(dir.join("theme/dracula.json").is_file());
        assert!(dir.join("README.md").is_file());
        assert!(
            !dir.join("screenshot.png").exists(),
            "only declarative files are extracted"
        );
        assert!(matches!(
            install_into(root.path(), "continue.continue"),
            Err(ExtError::Blocked(_))
        ));
        let py = install_into(root.path(), "ms-python.python").unwrap();
        assert_eq!(py.contributes["grammars"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejects_paths_outside_the_extension() {
        assert!(safe_rel("../evil.json").is_none());
        assert!(safe_rel("/etc/passwd").is_none());
        assert!(safe_rel("syntaxes/../../x").is_none());
        assert_eq!(
            safe_rel("./syntaxes/a.json"),
            Some(PathBuf::from("syntaxes/a.json"))
        );
        assert!(valid_id("a.b").is_ok());
        assert!(valid_id("a/../b.c").is_err());
    }
}
