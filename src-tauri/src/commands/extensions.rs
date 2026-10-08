//! Real extension installs from Open VSX, limited to what CodeUI can honour without an
//! extension host: syntax grammars, language configuration and colour themes.
//!
//! Extension code (`main`/`browser`), snippets and everything else in the VSIX is never
//! written to disk. Extensions flagged by the AI policy (a multi-signal policy for known and
//! identifiable AI-assistance extensions) are refused here, not just hidden in the UI.

use std::collections::{BTreeSet, HashSet};
use std::io::{Cursor, Read, Seek};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const OPEN_VSX: &str = "https://open-vsx.org/api";
/// Open VSX metadata response (JSON) for one extension.
const MAX_META_BYTES: u64 = 8 * 1024 * 1024;
/// Compressed .vsix download: checked against Content-Length and the bytes actually read.
const MAX_VSIX_BYTES: u64 = 150 * 1024 * 1024;
/// One extracted file, counted on the bytes actually inflated (headers can lie).
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// Everything inflated from one package (package.json, grammars, themes, README...).
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;
/// Entries in the archive's central directory.
const MAX_ENTRIES: usize = 50_000;
const STATE_FILE: &str = ".state.json";

#[derive(Clone, Copy)]
struct Limits {
    vsix: u64,
    file: u64,
    total: u64,
    entries: usize,
}

const LIMITS: Limits = Limits {
    vsix: MAX_VSIX_BYTES,
    file: MAX_FILE_BYTES,
    total: MAX_TOTAL_BYTES,
    entries: MAX_ENTRIES,
};

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
    compact_terms: Vec<String>,
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

/// Zero-width and other invisible characters that would otherwise split or disguise a word.
fn is_invisible(c: char) -> bool {
    matches!(
        c,
        '\u{200B}'..='\u{200D}' | '\u{2060}' | '\u{FEFF}' | '\u{00AD}'
    )
}

/// Lowercase alphanumeric words. Invisible characters vanish ("C\u{200B}opilot" is one word),
/// fullwidth ASCII folds to ASCII, everything else (spaces, punctuation, `_`, `-`) separates.
/// Must stay identical to `words` in src/services/aiPolicy.ts.
fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in text.chars().filter(|&c| !is_invisible(c)) {
        let c = match c {
            '\u{FF01}'..='\u{FF5E}' => char::from_u32(c as u32 - 0xFEE0).unwrap_or(c),
            _ => c,
        };
        if c.is_alphanumeric() {
            cur.extend(c.to_lowercase());
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Longest joined run of words worth building; longer than any policy term.
const MAX_RUN: usize = 40;

/// Every run of consecutive words joined without separators, so "co pilot", "Co-Pilot" and
/// "co_pilot" all yield "copilot" while "maintain" never yields "ai" (runs start and end on
/// word boundaries).
fn word_runs(w: &[String]) -> HashSet<String> {
    let mut runs = HashSet::new();
    for i in 0..w.len() {
        let mut run = String::new();
        for word in &w[i..] {
            run.push_str(word);
            runs.insert(run.clone());
            if run.len() >= MAX_RUN {
                break;
            }
        }
    }
    runs
}

/// Why `id` + free text identify an AI-assistance extension, if they do.
pub fn ai_block_reason(id: &str, text: &str) -> Option<String> {
    let p = policy();
    let clean_id: String = id
        .chars()
        .filter(|&c| !is_invisible(c))
        .collect::<String>()
        .trim()
        .to_lowercase();
    if p.blocked_ids.contains(&clean_id) {
        return Some(format!("{id} is an AI extension"));
    }
    let w = words(&format!("{id} {text}"));
    let spaced = format!(" {} ", w.join(" "));
    if let Some(t) = p
        .terms
        .iter()
        .find(|t| spaced.contains(&format!(" {} ", words(t).join(" "))))
    {
        return Some(format!("AI-related (\"{t}\")"));
    }
    let runs = word_runs(&w);
    if let Some(t) = p
        .compact_terms
        .iter()
        .find(|t| runs.contains(&words(t).concat()))
    {
        return Some(format!("AI-related (\"{t}\")"));
    }
    if let Some(pre) = p
        .prefixes
        .iter()
        .find(|pre| runs.iter().any(|r| r.starts_with(pre.as_str())))
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
        if let Some(k) = contributes
            .keys()
            .find(|k| p.manifest_keys.iter().any(|mk| mk.eq_ignore_ascii_case(k)))
        {
            return Some(format!("contributes \"{k}\""));
        }
    }
    // Lowercased and trimmed, invisible characters removed, so case or a zero-width space
    // cannot hide "onChatParticipant".
    let lower = |key: &str| -> Vec<String> {
        strings_in(m.get(key).unwrap_or(&Value::Null))
            .into_iter()
            .map(|s| {
                s.chars()
                    .filter(|&c| !is_invisible(c))
                    .collect::<String>()
                    .trim()
                    .to_lowercase()
            })
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
    let text: Vec<String> = [
        "name",
        "displayName",
        "description",
        "keywords",
        "categories",
    ]
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

/// Reads at most `cap` bytes; one byte more means the source is too large. Counts what is
/// actually read, never a size the sender or an archive header declares.
fn read_capped(r: impl Read, cap: u64, what: &str) -> Result<Vec<u8>, ExtError> {
    let mut buf = Vec::new();
    r.take(cap + 1).read_to_end(&mut buf)?;
    if buf.len() as u64 > cap {
        return Err(ExtError::Invalid(format!(
            "{what} is larger than the {cap}-byte limit"
        )));
    }
    Ok(buf)
}

/// A plain relative archive path: not absolute, no drive prefix, no `..`, no backslashes
/// (Windows separators), no `:` (drive letters, alternate data streams) or NUL.
fn safe_entry_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.contains(['\\', ':', '\0'])
        && name.split('/').all(|c| c != "..")
}

/// Rejects the whole package if it has too many entries or any entry whose path could
/// escape the extension folder. Malicious-looking archives are refused, not cleaned up.
fn check_archive<R: Read + Seek>(zip: &mut ZipArchive<R>, limits: &Limits) -> Result<(), ExtError> {
    if zip.len() > limits.entries {
        return Err(ExtError::Invalid(format!(
            "package has {} files (limit {})",
            zip.len(),
            limits.entries
        )));
    }
    for i in 0..zip.len() {
        let f = zip
            .by_index_raw(i)
            .map_err(|e| ExtError::Invalid(e.to_string()))?;
        if f.enclosed_name().is_none() || !safe_entry_name(f.name()) {
            return Err(ExtError::Invalid(format!(
                "package contains an unsafe path: {:?}",
                f.name()
            )));
        }
    }
    Ok(())
}

const S_IFMT: u32 = 0o170000;
const S_IFLNK: u32 = 0o120000;

/// Inflates one entry (`None` if absent). The per-file cap and the package-wide `budget`
/// are enforced on the bytes actually inflated. Symlink entries are never extracted.
fn read_entry<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    name: &str,
    budget: &mut u64,
    limits: &Limits,
) -> Result<Option<Vec<u8>>, ExtError> {
    let f = match zip.by_name(name) {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(ExtError::Invalid(e.to_string())),
    };
    if f.unix_mode().is_some_and(|m| m & S_IFMT == S_IFLNK) {
        return Err(ExtError::Invalid(format!(
            "package contains a symlink: {name}"
        )));
    }
    let bytes = if *budget < limits.file {
        read_capped(f, *budget, "the unpacked package")?
    } else {
        read_capped(f, limits.file, name)?
    };
    *budget -= bytes.len() as u64;
    Ok(Some(bytes))
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

    let raw_meta = read_capped(
        http_get(&format!("{OPEN_VSX}/{ns}/{name}"))?.into_reader(),
        MAX_META_BYTES,
        "extension metadata",
    )?;
    let meta: Value =
        serde_json::from_slice(&raw_meta).map_err(|e| ExtError::Network(e.to_string()))?;
    let listing: Vec<String> = [
        "name",
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
    let resp = http_get(url)?;
    let declared = resp
        .header("Content-Length")
        .and_then(|v| v.trim().parse::<u64>().ok());
    if declared.is_some_and(|n| n > MAX_VSIX_BYTES) {
        return Err(ExtError::Invalid(format!(
            "package is larger than the {MAX_VSIX_BYTES}-byte limit"
        )));
    }
    let vsix = read_capped(resp.into_reader(), MAX_VSIX_BYTES, "package")?;
    install_vsix(root, &id, vsix, &LIMITS)
}

/// Unpacks the declarative parts of a downloaded VSIX into `root/<id>`. Nothing is left
/// behind on failure: a partial extraction is removed.
fn install_vsix(
    root: &Path,
    id: &str,
    vsix: Vec<u8>,
    limits: &Limits,
) -> Result<InstalledExtension, ExtError> {
    if vsix.len() as u64 > limits.vsix {
        return Err(ExtError::Invalid(format!(
            "package is larger than the {}-byte limit",
            limits.vsix
        )));
    }
    let mut zip =
        ZipArchive::new(Cursor::new(vsix)).map_err(|e| ExtError::Invalid(e.to_string()))?;
    check_archive(&mut zip, limits)?;
    let mut budget = limits.total;

    let raw = read_entry(&mut zip, "extension/package.json", &mut budget, limits)?
        .ok_or_else(|| ExtError::Invalid("package has no package.json".into()))?;
    let mut manifest: Value =
        serde_json::from_slice(&raw).map_err(|e| ExtError::Invalid(e.to_string()))?;
    if let Some(r) = manifest_block_reason(id, &manifest) {
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
    let dest = root.join(id);

    let mut fill = || -> Result<(), ExtError> {
        let mut i = 0;
        while i < wanted.len() {
            let rel = wanted[i].clone();
            i += 1;
            let name = format!("extension/{}", rel.to_string_lossy().replace('\\', "/"));
            let Some(bytes) = read_entry(&mut zip, &name, &mut budget, limits)? else {
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
            let out = tmp.join(&rel);
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(out, bytes)?;
        }
        let readme = zip
            .file_names()
            .find(|n| n.eq_ignore_ascii_case("extension/readme.md"))
            .map(str::to_string);
        if let Some(readme) = readme {
            if let Some(bytes) = read_entry(&mut zip, &readme, &mut budget, limits)? {
                std::fs::write(tmp.join("README.md"), bytes)?;
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

        let _ = std::fs::remove_dir_all(&dest);
        std::fs::rename(&tmp, &dest)?;
        Ok(())
    };
    if let Err(e) = fill() {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }

    let mut state = load_state(root);
    state.disabled.remove(id);
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

    // --- AI policy: signals, bypass attempts, false positives ---

    #[test]
    fn policy_has_a_version() {
        let raw: Value = serde_json::from_str(include_str!("../../ai-policy.json")).unwrap();
        assert!(raw["version"].as_u64().is_some());
    }

    #[test]
    fn blocks_known_ids_in_any_case_or_padding() {
        for id in [
            "github.copilot",
            "GitHub.Copilot",
            " anthropic.claude-code ",
            "continue\u{200B}.continue",
        ] {
            assert!(ai_block_reason(id, "").is_some(), "{id:?}");
        }
    }

    #[test]
    fn blocks_ai_keywords_and_phrases() {
        for text in [
            "AI",
            "Ask questions with a large language model",
            "Your AI pair programmer",
            "Powered by ChatGPT",
            "Local models through Ollama",
        ] {
            assert!(ai_block_reason("foo.bar", text).is_some(), "{text:?}");
        }
        let m = serde_json::json!({ "keywords": ["formatter", "AI"] });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
        let m = serde_json::json!({ "name": "copilot-helper" });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
    }

    #[test]
    fn spelling_tricks_do_not_bypass_the_policy() {
        for text in [
            "Co-Pilot",
            "co pilot",
            "C\u{200B}opilot",
            "c\u{FEFF}o\u{200D}pilot",
            "CO_PILOT",
            "co.pilot",
            "c o p i l o t",
            "\u{FF23}\u{FF4F}\u{FF50}\u{FF49}\u{FF4C}\u{FF4F}\u{FF54}", // fullwidth "Copilot"
            "Chat-GPT",
            "Open AI",
            "Clau_de",
            "A.I. helper",
            "gpt4o",
        ] {
            assert!(ai_block_reason("foo.bar", text).is_some(), "{text:?}");
        }
    }

    #[test]
    fn blocks_ai_manifest_capabilities() {
        for m in [
            serde_json::json!({ "contributes": { "chatParticipants": [] } }),
            serde_json::json!({ "contributes": { "languageModels": [] } }),
            serde_json::json!({ "contributes": { "LanguageModelChatProviders": [] } }),
        ] {
            assert!(manifest_block_reason("foo.bar", &m).is_some(), "{m}");
        }
    }

    #[test]
    fn blocks_ai_api_proposals_and_activation_events() {
        for p in [
            "chatProvider",
            "languageModels",
            "inlineCompletionsAdditions",
            " ChatParticipant\u{200B}Private",
        ] {
            let m = serde_json::json!({ "enabledApiProposals": [p] });
            assert!(manifest_block_reason("foo.bar", &m).is_some(), "{p:?}");
        }
        for e in ["onChatParticipant:foo.bar", "onLanguageModelChat:x"] {
            let m = serde_json::json!({ "activationEvents": ["onLanguage:rust", e] });
            assert!(manifest_block_reason("foo.bar", &m).is_some(), "{e:?}");
        }
    }

    #[test]
    fn blocks_ai_dependencies_and_pack_members() {
        let m = serde_json::json!({ "extensionDependencies": ["GitHub.copilot-chat"] });
        assert!(manifest_block_reason("foo.bar", &m).is_some());
        let m = serde_json::json!({
            "extensionPack": ["esbenp.prettier-vscode", " Continue.Continue "]
        });
        assert!(manifest_block_reason("foo.pack", &m).is_some());
        let m = serde_json::json!({ "extensionPack": ["someone.tabnine-bridge"] });
        assert!(manifest_block_reason("foo.pack", &m).is_some());
    }

    #[test]
    fn does_not_flag_ordinary_extensions() {
        for (id, text) in [
            (
                "ms-python.python",
                "Python IntelliSense (Pylance), Debugging, linting",
            ),
            (
                "esbenp.prettier-vscode",
                "Prettier - Code formatter using prettier",
            ),
            (
                "rust-lang.rust-analyzer",
                "Rust Analyzer Rust language support for Visual Studio Code",
            ),
            (
                "foo.chain",
                "Blockchain explorer: follow the chain of blocks",
            ),
            ("foo.themes", "Free and paid colour themes"),
            ("foo.ddd", "Helps maintain domain models in large codebases"),
            ("foo.thai", "Thai language support and word breaking"),
            ("foo.tests", "Black box testing helpers"),
            ("foo.graphs", "Source graph visualizer for dependencies"),
            ("foo.xray", "Code X-ray: inspect C line endings"),
            ("foo.openapi", "OpenAPI and Swagger editor"),
        ] {
            assert_eq!(ai_block_reason(id, text), None, "{id} {text:?}");
        }
        let m = serde_json::json!({
            "name": "prettier-vscode",
            "displayName": "Prettier - Code formatter",
            "keywords": ["formatter", "prettier"],
            "activationEvents": ["onStartupFinished"],
            "extensionPack": ["ms-python.python", "rust-lang.rust-analyzer"],
            "contributes": { "languages": [], "grammars": [] }
        });
        assert_eq!(manifest_block_reason("esbenp.prettier-vscode", &m), None);
    }

    // --- VSIX extraction ---

    use std::io::Write;
    use zip::write::SimpleFileOptions;

    const TEST_LIMITS: Limits = Limits {
        vsix: 1 << 20,
        file: 1000,
        total: 2500,
        entries: 10,
    };

    fn manifest(grammars: &[&str]) -> Vec<u8> {
        let g: Vec<Value> = grammars
            .iter()
            .enumerate()
            .map(|(i, p)| {
                serde_json::json!({ "language": format!("l{i}"), "scopeName": format!("source.l{i}"), "path": p })
            })
            .collect();
        serde_json::to_vec(&serde_json::json!({
            "publisher": "test", "name": "lang", "version": "1.0.0",
            "main": "./out/extension.js",
            "contributes": { "grammars": g }
        }))
        .unwrap()
    }

    fn vsix(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    /// Installs into a fresh root; a failed install must leave nothing behind.
    fn try_install(vsix: Vec<u8>) -> (tempfile::TempDir, Result<InstalledExtension, ExtError>) {
        let root = tempfile::tempdir().unwrap();
        let r = install_vsix(root.path(), "test.lang", vsix, &TEST_LIMITS);
        if r.is_err() {
            let left: Vec<_> = std::fs::read_dir(root.path()).unwrap().collect();
            assert!(left.is_empty(), "partial extraction left behind: {left:?}");
        }
        (root, r)
    }

    fn rejection(vsix: Vec<u8>) -> String {
        match try_install(vsix).1 {
            Err(ExtError::Invalid(m)) => m,
            other => panic!("expected rejection, got {:?}", other.map(|e| e.id)),
        }
    }

    #[test]
    fn installs_only_declarative_files() {
        let pkg = manifest(&["./syntaxes/a.json"]);
        let (root, r) = try_install(vsix(&[
            ("extension/package.json", &pkg),
            ("extension/syntaxes/a.json", b"{}"),
            ("extension/out/extension.js", b"require('child_process')"),
            ("extension/README.md", b"# Lang"),
        ]));
        let ext = r.unwrap();
        assert!(ext.has_code);
        let dir = root.path().join("test.lang");
        assert!(dir.join("syntaxes/a.json").is_file());
        assert!(dir.join("README.md").is_file());
        assert!(
            !dir.join("out").exists(),
            "extension code is never extracted"
        );
        let saved: Value =
            serde_json::from_slice(&std::fs::read(dir.join("package.json")).unwrap()).unwrap();
        assert!(saved.get("main").is_none());
        assert!(!root.path().join("test.lang.partial").exists());
    }

    #[test]
    fn refuses_an_ai_manifest_without_extracting() {
        let pkg = br#"{"publisher":"test","name":"lang","contributes":{"chatParticipants":[]}}"#;
        let (_root, r) = try_install(vsix(&[("extension/package.json", pkg)]));
        assert!(matches!(r, Err(ExtError::Blocked(_))));
    }

    #[test]
    fn rejects_path_traversal_entries() {
        let pkg = manifest(&[]);
        for evil in [
            "extension/../../evil.txt",
            "../evil.txt",
            "extension/syntaxes/../../../evil.txt",
        ] {
            let m = rejection(vsix(&[("extension/package.json", &pkg), (evil, b"x")]));
            assert!(m.contains("unsafe path"), "{evil}: {m}");
        }
    }

    #[test]
    fn rejects_absolute_drive_and_backslash_entries() {
        let pkg = manifest(&[]);
        for evil in [
            "/etc/evil",
            "C:/Windows/evil.txt",
            "C:\\Windows\\evil.txt",
            "extension\\..\\..\\evil.txt",
            "\\\\server\\share\\evil.txt",
            "extension/a.json:stream",
        ] {
            let m = rejection(vsix(&[("extension/package.json", &pkg), (evil, b"x")]));
            assert!(m.contains("unsafe path"), "{evil}: {m}");
        }
    }

    #[test]
    fn never_extracts_symlink_entries() {
        let pkg = manifest(&["./syntaxes/a.json"]);
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        w.start_file("extension/package.json", SimpleFileOptions::default())
            .unwrap();
        w.write_all(&pkg).unwrap();
        w.add_symlink(
            "extension/syntaxes/a.json",
            "/etc/passwd",
            SimpleFileOptions::default(),
        )
        .unwrap();
        let m = rejection(w.finish().unwrap().into_inner());
        assert!(m.contains("symlink"), "{m}");
    }

    #[test]
    fn rejects_a_single_oversized_file() {
        let pkg = manifest(&["./syntaxes/a.json"]);
        let big = vec![b' '; TEST_LIMITS.file as usize + 1];
        let m = rejection(vsix(&[
            ("extension/package.json", &pkg),
            ("extension/syntaxes/a.json", &big),
        ]));
        assert!(m.contains("limit"), "{m}");
    }

    #[test]
    fn rejects_a_decompression_bomb() {
        // Each file is under the per-file cap; together they inflate past the total budget.
        let pkg = manifest(&["./a.json", "./b.json", "./c.json"]);
        let chunk = vec![0u8; 900];
        let m = rejection(vsix(&[
            ("extension/package.json", &pkg),
            ("extension/a.json", &chunk),
            ("extension/b.json", &chunk),
            ("extension/c.json", &chunk),
        ]));
        assert!(m.contains("unpacked package"), "{m}");
    }

    #[test]
    fn rejects_too_many_entries() {
        let pkg = manifest(&[]);
        let names: Vec<String> = (0..TEST_LIMITS.entries)
            .map(|i| format!("extension/f{i}.txt"))
            .collect();
        let mut entries: Vec<(&str, &[u8])> = vec![("extension/package.json", &pkg)];
        entries.extend(names.iter().map(|n| (n.as_str(), &b"x"[..])));
        let m = rejection(vsix(&entries));
        assert!(m.contains("files"), "{m}");
    }

    #[test]
    fn rejects_an_oversized_download() {
        let m = rejection(vec![0u8; TEST_LIMITS.vsix as usize + 1]);
        assert!(m.contains("limit"), "{m}");
    }
}
