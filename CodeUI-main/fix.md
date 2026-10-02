# CodeUI v0.1 Fix Plan

**Author role:** Investigation / planning AI (no source code was modified).
**Audience:** the implementation AI that will modify CodeUI.
**Scope:** stability and correctness pass on v0.1.0 for **Windows + Ubuntu/Linux**. macOS deferred. No website, AI, autocomplete, Git, LSP, or new product features.

**Evidence labels used throughout**

| Label | Meaning |
|---|---|
| **[Confirmed]** | Directly demonstrated by code in the repository (file named). |
| **[Likely]** | Strong hypothesis from code + known platform/library behaviour; needs one cheap test to close. |
| **[Possible]** | Plausible, not proven. |
| **[Unknown]** | Cannot be decided from the repository; needs a real machine. |

> Limits of this investigation: I read the full source tree from the zip (frontend, Rust, configs, workflows, docs). I could **not** run the app, install `node_modules`, or open the committed installers, so nothing about Monaco/xterm/WebView internals or runtime timing was observed live. Everything about rendering is therefore labelled Likely/Possible/Unknown unless the repo code itself proves it.

---

## 1. Executive Summary

The most important finding is architectural, not a single bug:

> **The Run button never uses the Rust runner system.** `processService` (`run_file`, `stop_run`, stdin, timeouts, Java class detection, tool checks) is imported by **no** component. `runActiveFile()` in `useWorkspaceStore.ts` builds shell strings and types them into the PTY. All the "lab-safe" runner work (timeouts, process groups, scratch dirs, compiler-missing errors) is dead code from the UI's point of view. **[Confirmed]** (`grep processService` → only its own file.)

Second most important: **the code contains several things that only work on the author's machine** (`D:\JAVA` as default workspace, `C:\Users\sahil\CodeUI` in recent folders, `python3`-only runner, PATH assumptions, unbundled fonts). That alone explains much of "works on S's computer, breaks elsewhere." **[Confirmed]** for the hard-coded values; their causal role in each symptom is **[Likely]**.

### Findings at a glance

| ID | Finding | Severity | Status |
|---|---|---|---|
| F1 | Hard-coded `D:\JAVA`, `C:\Users\sahil\CodeUI` as default workspace/recents (store + settings default + mock fs) | High | Confirmed |
| F2 | Two execution systems; UI uses only the shell-string/PTY one; Rust runner unused | High | Confirmed |
| F3 | PTY lifecycle race: Run and `TerminalPanel` can each spawn a different PTY; output emitted before a listener exists is lost; panel unmount discards xterm contents | High | Confirmed (code) / Likely (observed "miss") |
| F4 | Windows run command uses `$?` after an assignment → compile errors still "succeed" and run a stale `.exe` | High | Confirmed (PowerShell semantics; verify) |
| F5 | Python runner hard-requires `python3` (absent/stubbed on most Windows machines); tool detection and runner disagree; GUI-launched apps get a different PATH | High | Confirmed (code) / Likely (impact) |
| F6 | Ctrl+S registered once in Monaco `onMount` closes over the first file's `path` and a stale `saveFile` (stale `openFiles`) → can save wrong/old content to the wrong file | **Critical** | Likely (needs 2-minute test) |
| F7 | Editor never calls `focus()` after open/switch; `saveViewState={false}`; Monaco remounts on welcome/extension tabs; custom theme has no cursor colour; xterm cursor CSS targets a canvas layer that the DOM renderer doesn't have; terminal blank after panel reopen | High | Confirmed (no `focus()`), Likely (rest) |
| F8 | No bundled monospace font; Monaco measures `Consolas, 'Courier New', monospace` which doesn't exist on Ubuntu → possible wrong char-width → overlapping glyphs | High | Likely (hypothesis for overlap) |
| F9 | Overlap that "heals after 30–60 min": root cause **unknown**; main-thread stalls are a candidate (sync Tauri commands on main thread, unbatched PTY events, TS worker/all languages eager) | Critical | Unknown — needs instrumentation (§5, §16) |
| F10 | Explorer has two sources of truth; root vs nested ops take different code paths; nested rename/delete never touch open tabs; rename = close + reopen from disk (loses unsaved edits); delete of a folder doesn't close descendants; all errors only `console.error` | High | Confirmed |
| F11 | `window.prompt()/confirm()/alert()` used for New File / Delete — unreliable inside Tauri WebViews on some platforms | Medium–High | Possible (test per OS) |
| F12 | Syntax highlighting: fragile deep imports from `monaco-editor/esm/vs/languages/definitions/…`, registration done 3×, `build.target: esnext` vs old WebKitGTK | High | Unknown root cause; Confirmed fragility |
| F13 | No diagnostics pipeline; `onDidChangeMarkers` counts markers nobody produces for C/C++/Java/Python | Medium | Confirmed |
| F14 | "No autocomplete" is only partly enforced: Monaco's built-in TS/JSON/CSS/HTML language services still contribute completion/hover/diagnostics | Medium | Likely |
| F15 | Release hygiene: two different `…x64-setup.exe` (different hashes) committed under `installer/` and `installers/`; no checksums; no build stamp; `embedBootstrapper` needs internet; Ubuntu 22.04 baseline; CI never builds a packaged app | High | Confirmed |
| F16 | Sync (non-`async`) Tauri commands run on the main thread: `spawn_pty`, `write_pty`, `list_dir`, `search_files`, `find_files`… can freeze the UI; PTY output is emitted per 8 KB read with no batching | Medium–High | Likely |
| F17 | Save path normalises CRLF→LF on read and always writes LF; writes via sibling temp file + rename (can fail intermittently on Windows with AV/OneDrive) | Low–Medium | Confirmed / Possible |

---

## 2. Confirmed Repository Architecture

```
React 18 (App.tsx, useWorkspace() hook = single store, no Redux/Zustand)
 ├─ Explorer: FileTree.tsx (own caches: expandedFolders, folderContents, loadingFolders)
 ├─ Editor:   SplitEditorContainer → MonacoEditorGroup → @monaco-editor/react <Editor>
 ├─ Terminal: TerminalPanel (lazy) → xterm.js (DOM renderer, no canvas/webgl addon) → ptyService
 └─ services/*: fsService, ptyService, processService (UNUSED), envService, settingsService, editorService (module-global editor/monaco refs)
        │ Tauri IPC (invoke / listen)
Rust (src-tauri)
 ├─ commands/fs.rs        read/write/list/create/rename/delete (sync fns; errors = {kind,message} objects)
 ├─ commands/terminal.rs  spawn/write/resize/kill_pty → pty/mod.rs (portable-pty; events pty-data-{id}, pty-exit-{id})
 ├─ commands/process.rs   run_file → runners/{c,cpp,java,python,salivo} → proc/{mod,kill}  (UNUSED BY UI)
 ├─ commands/env_detect.rs  which::which over PATH
 └─ commands/settings.rs  ~/.config/codeui/settings.json (dirs::config_dir)
```

Key facts verified in code:

* **Monaco loading.** `main.tsx` does `import * as monaco from "monaco-editor"` (the *entire* bundle, including TS/CSS/HTML/JSON language services), imports five `?worker` constructors (incl. `ts.worker`), defines theme `codeui-dark`, sets `self.MonacoEnvironment.getWorker`, then `loader.config({ monaco })` so `@monaco-editor/react` uses the local instance (no CDN). This is correct in principle and gives a single Monaco instance **[Confirmed]**; whether a duplicate exists in the packaged bundle is **[Unknown]** (see §4 check list).
* **Language registration** runs three times: `main.tsx`, `<Editor beforeMount>`, `<Editor onMount>` (`registerAllEagerLanguages`). Each call re-runs `setMonarchTokensProvider/setLanguageConfiguration` for 17 languages. It also maps **`c` → the C++ Monarch definition**. **[Confirmed]**
* **Editor content flow.** `<Editor value={file.content} onChange=…>` → `updateFileContent` → `setOpenFiles(map)` → whole `App` re-renders on every keystroke (App is ~700 lines, owns all state). Monaco's React wrapper compares `editor.getValue() !== value`, so no echo edit, but React work is per keystroke. **[Confirmed]**
* **One editor instance per group, models keyed by `path={getNormalizedUri(file.path)}`**, `keepCurrentModel`, `saveViewState={false}`. `MonacoEditorGroup` is *unmounted* (returns watermark/Welcome/Extension components) whenever the active tab is not a file → the `<Editor>` is torn down and re-created on return. **[Confirmed]** (`SplitEditorContainer` early returns, `if (!file)` in the group.)
* **Terminal** is rendered only when `panelVisible && activePanelTab==="terminal"`; closing the panel or switching to "Live Preview" **disposes the xterm instance** but leaves the Rust PTY running. **[Confirmed]**
* **Run.** `runActiveFile` → ensure PTY → write a language-specific shell string (PowerShell if the *path contains a backslash*, bash-style otherwise) → `setTimeout(...focus-terminal, 100)`. **[Confirmed]**
* **Rust PTY `spawn`** inserts into the session map without checking for an existing id (silently overwrites; old shell not killed); invalid `cwd` is silently ignored. **[Confirmed]**
* **Tauri config.** CSP is `script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; font-src 'self' data:` — workers/Monaco fine, but **no web fonts are shipped**, so any named font must be on the machine. WebView2 installed via `embedBootstrapper` (needs network at install). Capabilities file only lists `core:*` window perms (custom commands are not gated). **[Confirmed]**
* **Build.** `vite build` with `target: "esnext"`, manual chunks put all of Monaco into `monaco-vendor`. CI never runs `tauri build`; only the tag-triggered Release workflow produces installers. **[Confirmed]**

### Answer to the mandatory question — "Which execution system does the Run button use?"

**System B only** (frontend-generated shell strings → `writePty`). Trace: `RunDebugBar.onRunFile` / `TitleBar.onRunFile` / `RunPanel.onRunFile` / F5 handler → `runActiveFile()`. **System A** (`run_file` + `LanguageRunner`) has Tauri commands registered in `lib.rs` and integration tests in `src-tauri/tests/runner_pipeline.rs`, but no UI path invokes it. Decision in §8.

---

## 3. Problem-by-Problem Diagnosis

### Problem 1 — Text appears horizontally overlapped / corrupted; recovers after 30–60 min

**User symptom.** Lines look compressed/overlapped (as if line breaks or glyph advance are wrong). Self-heals after a very long time.

**Reproduction (to be performed per §16).** C file, type continuously, switch tabs, resize, open/close terminal, run a program with output, soak 30+ min; repeat on packaged build, Windows + Ubuntu, with/without GPU workarounds.

**Relevant files.** `src/main.tsx`, `src/components/editor/MonacoEditorGroup.tsx`, `monacoSafeDefaults.ts`, `src/index.css`, `src/languages/registerAllLanguages.ts`, `src-tauri/tauri.conf.json`, `commands/*.rs` (sync commands).

**Current behaviour.** `automaticLayout: true` **and** `editor.layout()` in `onMount` and in a `requestAnimationFrame` effect keyed on `file.path`. `fontFamily: "Consolas, 'Courier New', monospace"`, `lineHeight: 21`, minimap enabled. `document.fonts.ready.then(remeasureFonts)` is the only font handling, but no `@font-face` exists, so `fonts.ready` resolves immediately and nothing is ever re-measured when a system font resolves differently.

**First question: is the model wrong or only the view?** Unknown. The diagnosis protocol in §5.1 answers it in 30 seconds on a failing machine (compare `model.getValue()`/`getLineCount()` to what is drawn, and `getLayoutInfo()` to the DOM rect).

**Ranked hypotheses**

| # | Hypothesis | Label | Why / why not |
|---|---|---|---|
| H1 | **Font metric mismatch.** Monaco assumes a monospace font and caches measured char widths. On Ubuntu `Consolas`/`Courier New` are normally absent; `monospace` usually maps to DejaVu Sans Mono, but on minimal/VM/lab images fontconfig can map it to something else or the measurement can run against a fallback and never be redone. Wrong advance width ⇒ glyph overlap/gaps — exactly "characters rendered on top of each other." | Likely (for Linux), Possible (Windows: Consolas always present, but DPI scaling 125/150 % + zoom changes metrics) | Fits "works on S's machine (Consolas present)". Doesn't by itself explain a 30–60 min heal. |
| H2 | **Main thread starvation / stalled painting.** Sync Tauri commands run on the main thread (`spawn_pty`, `write_pty` — whose own comment admits it can block, `list_dir`, `search_files`, `find_files`); PTY emits an IPC event per 8 KB read with no batching; every keystroke re-renders `App`; whole Monaco incl. TS service parsed at start; minimap on. WebKitGTK software-rendering on lab hardware makes all of this worse. | Likely contributor | Explains slowness/"catch-up" pattern, not wrong glyph positions. |
| H3 | **WebView GPU/compositing bug** (WebKitGTK DMABUF/compositing issues on some Ubuntu/NVIDIA/VM setups; WebView2 GPU blocklist). Produces garbled paint that clears when layers are re-rasterised. | Possible | Cheap to test with env flags (§4). |
| H4 | **Layout feedback loop**: `automaticLayout` (ResizeObserver) + manual `layout()` + terminal ResizeObserver + `touch-action:none`. | Possible, low weight | Redundant, but each call is cheap and idempotent; unlikely to take an hour to settle. |
| H5 | **Model/view mismatch from controlled `value`** (React value vs model during rapid typing + tab switch with `keepCurrentModel`). | Possible, low weight | Wrapper guards equal values; but combined with F6 stale closures, content desync is real for *saving*, not for painting. |
| H6 | **Monarch tokenizer cost** (C mapped to the C++ grammar; re-registering providers 3× retokenises every model each time an editor mounts). | Possible | Affects colour latency/CPU, not glyph positions. |

**Root cause: [Unknown].** The plan is to (a) eliminate H1/H4/H5/H6 by construction (they are cheap, low-risk and correct regardless), (b) add instrumentation so H2/H3 can be proven or ruled out on the failing machines, (c) not add timers.

**Evidence still required** — see §5.1 and §16: failing-machine capture of: `getLayoutInfo`, `fontInfo`, `document.fonts.check`, computed `font-family`, `devicePixelRatio`, long-task log, CPU/RAM of `WebKitWebProcess`/`msedgewebview2.exe`, result with `WEBKIT_DISABLE_COMPOSITING_MODE=1` / `WEBKIT_DISABLE_DMABUF_RENDERER=1` / `--disable-gpu`.

**Proposed fix.** §5 (bundle a monospace font and gate first editor mount on it; remove redundant layout calls; make the Monaco **model** the source of truth so keystrokes don't re-render `App`; register languages once; single Monaco entry; measure main thread; make heavy Rust commands `async`).

**Alternatives considered.** Switch Monaco `fontFamily` to generic `monospace` only (cheap, helps but depends on fontconfig); disable minimap/smooth features as default (kept as an A/B experiment, not a default change — the brief forbids "fixing" by removing functionality without cause); replace Monaco (out of scope); `setTimeout` relayout (rejected).

**Risks.** Bundling a font adds ~100–300 KB (woff2). Changing content ownership touches save/run/search/preview code (see §5.4).

---

### Problem 2 — No visible cursor (editor and terminal)

**Symptom.** Can't see where typing goes in editor; terminal cursor sometimes missing.

**Relevant files.** `monacoSafeDefaults.ts`, `main.tsx` (theme), `MonacoEditorGroup.tsx`, `TerminalPanel.tsx`, `index.css` (lines ~97–115, ~791–822).

**Editor — current behaviour & findings**

* **[Confirmed]** Nothing in the editor code calls `editor.focus()` when a file is opened, a tab is switched, a file is created, or the terminal closes. Monaco draws the caret only when the editor has focus. After "New File"/open from explorer the focus is on the explorer item or prompt → *no caret until the user clicks*. This is the most direct explanation of "no visible cursor" and needs no exotic cause.
* **[Confirmed]** Theme `codeui-dark` defines many colours but **no `editorCursor.foreground`** → relies on the inherited `vs-dark` default (a mid-grey `#AEAFAD`), low contrast on `#1e1e1e`/#`282828` current-line highlight.
* **[Confirmed]** `saveViewState={false}` drops cursor/scroll per tab, and the `<Editor>` is re-created whenever Welcome/Extension tabs are shown (so caret state is lost).
* **[Confirmed]** CSS `.monaco-editor { touch-action: none }` and `* { user-select: none }` (the latter re-enabled for `.inputarea`). Not a cause by itself, but unneeded.

**Terminal — current behaviour & findings**

* **[Confirmed]** No `@xterm/addon-canvas` / `addon-webgl` in `package.json` ⇒ xterm 5.5 uses its **DOM renderer**. The CSS `.terminal-xterm-viewport .xterm .xterm-cursor-layer {z-index:10}` targets a canvas-renderer layer that does not exist (dead CSS). The `.xterm-cursor-bar { opacity:1 !important; visibility:visible !important }` override can fight the DOM renderer's blink animation classes. **[Likely]** (verify in DevTools which element carries the cursor).
* **[Confirmed]** `term.focus()` is called immediately after `term.open()` inside a lazily-loaded panel whose container may not have its final size yet, and again after a fixed `setTimeout(…, 60)`; `window "focus-terminal"` is fired after a fixed 100 ms from Run. There is no "terminal is ready" signal.
* **[Confirmed]** When the panel is closed/reopened, or when the user visits Live Preview and returns, a **fresh xterm is created and the existing shell's prompt is never re-sent**. The terminal is blank (no prompt, no visible context) until Enter is pressed. To the user: "terminal has no cursor / doesn't work."

**Proposed fix.** §6.

**Alternatives.** Add a canvas/WebGL renderer addon (adds GPU risk on WebKitGTK — rejected for v0.1); force-focus on a timer (rejected).

**Risks.** Auto-focusing the editor must not steal focus from the terminal after Run (needs a single "focus target" owner, §6.3).

---

### Problem 3 — File and folder operations unreliable

**Symptom.** Create/rename/delete flaky; nested ops don't update; renamed files desync with tabs; deletes don't fully sync.

**Relevant files.** `useWorkspaceStore.ts`, `components/explorer/FileTree.tsx`, `services/fsService.ts`, `commands/fs.rs`, `App.tsx` (`handleNewFileDialog`).

**Current behaviour (all [Confirmed])**

1. **Two sources of truth.** Store: `fileTree` (root listing only). `FileTree`: `folderContents`, `expandedFolders`, `loadingFolders` (all sub-folders). `refreshExplorer()` refreshes only the root; the sub-folder cache is **never invalidated** (only `refreshSubfolder(parentPath)` after a nested op initiated by the tree itself). Collapse → expand re-uses the cache. Switching workspace does not clear the cache.
2. **Depth-dependent logic.** In `FileTree`: `if (parentPath === workspacePath) onCreateFile/onCreateFolder/onRenamePath/onDeletePath (store) else direct fsService + refreshSubfolder`. A string-equality test on paths (trailing slash, separator, case on Windows) can silently route an operation down the wrong branch.
3. **Nested rename/delete never update tabs.** They call `fsService` directly; the store is never told. Open tab keeps the old path; saving it later **re-creates the old file** (`write_file` of a path whose dir may still exist) or fails.
4. **Root rename = `closeFile(oldPath)` + `openFileByPath(newPath)`** which re-reads from disk → **unsaved edits are lost**, active tab/order/split state are reset, and a renamed *folder* leaves all descendant tabs pointing at dead paths.
5. **Delete** closes only the exact path; descendants of a deleted folder stay open.
6. **Stale closures.** `createNewFile` does `await refreshExplorer(); await openFileByPath(...)`; `openFileByPath` closes over `openFiles`, so rapid consecutive operations can open duplicates or skip.
7. **Path construction** is ad-hoc: `workspacePath.includes("\\") ? "\\" : "/"` repeated in 4+ places; no name validation (a name such as `a/b.c` or `..\x` is accepted and `create_file` uses `create_dir_all`, so it silently creates nested dirs/escapes the parent).
8. **Errors are swallowed.** Every catch is `console.error`. Also note Rust errors are objects `{kind, message}` (serde tagged enum), so even a naïve `alert(String(err))` would show `[object Object]`.
9. **Race on startup.** `workspacePath` defaults to `"D:\\JAVA"`; `refreshExplorer` runs for it, then settings load and set `lastFolder`; two un-cancelled `listDir` promises can resolve out of order (older wins).
10. **Dialogs.** New File uses `window.prompt`, Delete uses `window.confirm`, extension block uses `alert` — **[Possible]** unreliable in Tauri WebViews (platform-dependent; may return `null/false` immediately → "delete does nothing", "new file does nothing"). Needs an explicit per-OS test; the safe fix is in-app UI.

**Likely root cause.** Not Rust (primitives are correct: collision checks, atomic write, `remove_dir_all`), but the frontend: dual state + depth-dependent routing + missing tab synchronisation + swallowed errors + platform-dependent native dialogs.

**Evidence still required.** One manual pass per OS: root create/rename/delete; nested create/rename/delete; rename an open dirty file; rename a folder containing open files; delete a folder with open files; check that `prompt`/`confirm` appear on Windows and Ubuntu packaged builds.

**Proposed fix.** §7. **Alternatives:** Rust file watcher (`notify`) to auto-refresh (valuable but larger; defer, note as follow-up); keep FileTree's local cache but invalidate on every op (kept as fallback if lifting state is judged too large).

**Risks.** Touches explorer, store, editor model lifecycle. Do it after the editor model change (§5.4) so rename can move models cleanly.

---

### Problem 4 — Run Code "sometimes hit, sometimes miss"

**Relevant files.** `useWorkspaceStore.ts` (`ensurePtySession`, `runActiveFile`), `TerminalPanel.tsx`, `App.tsx`, `ptyService.ts`, `pty/mod.rs`, `commands/terminal.rs`, `commands/process.rs`, `runners/*`, `commands/env_detect.rs`.

**Confirmed defects, each independently able to produce "miss"**

**R1 — PTY session race (primary suspect for intermittency).**
`ensurePtySession` is a `useCallback` closing over `ptySessionId` **state**. Sequence when the terminal panel is closed and the user hits Run/F5:

1. `setPanelVisible(true)` → panel starts mounting; `TerminalPanel.setupSession` runs with `sessionId === null`, picks its own random id `pty-A`, attaches listeners for `pty-A`, calls `onEnsureSession("pty-A")`.
2. Meanwhile `runActiveFile` already awaited its own `ensurePtySession()` with the *same stale closure* (`ptySessionId === null`) → spawns **a second PTY** `pty-B` and writes the command to `pty-B`.
3. Both call `setPtySessionId`; last wins. Terminal is listening on `pty-A` (or switches later via the `[sessionId]` effect, after the command's output has already been emitted and dropped). Result: the command ran, nothing appears, or it appears in a different shell than the one the user types in.
4. Rust `spawn` has no duplicate-id protection and never kills the displaced shell → leaked shells; `pty-data-{id}` events from an overwritten session's reader thread keep emitting.

Whether the user sees "hit" or "miss" depends on millisecond-level timing — fast SSD dev machine "hits", lab machine "misses". **[Confirmed in code; Likely as the dominant observed cause.]**

**R2 — Output emitted before a listener exists is lost.** No scrollback/replay in Rust; listeners are attached after spawn in some paths. Same class of bug exists in the unused System A: `run_file` generates `run_id` in Rust and returns it, but its worker thread begins emitting `run-status-{id}` / `run-output-{id}` immediately; the frontend can only subscribe *after* the invoke resolves → early compile output is lost. **[Confirmed]**

**R3 — Command typed before the shell is ready.** `spawn_pty` returns as soon as the child is spawned. PowerShell with a profile can take 1–3 s; keystrokes sent during PSReadLine initialisation can be dropped or garbled. **[Possible]** (known PowerShell behaviour), cheap to test.

**R4 — Windows compile errors still run (logic bug).** Template: `javac "F"; $ms = $sw.ElapsedMilliseconds; if ($?) { ... run }`. `$?` reflects the *last statement*, which is the successful assignment, so after a failing `gcc`/`javac` the `if ($?)` is still true → prints "[Compiled in …ms]" and runs an old binary (or errors out). The student sees a stale program's output ("it ran my old code"). **[Confirmed by PowerShell semantics; verify with a 1-line test.]** Affects Java, C, C++, Rust, Salivo templates on Windows.

**R5 — Shell/quoting assumptions.** The command flavour is selected by `path.includes("\\")`, not by the actual shell. If `cmd.exe` is the shell (fallback when `powershell.exe` isn't on PATH), `$sw`/`;` syntax breaks. On Linux `$SHELL` may be zsh/fish/dash (`echo -e` is not portable to dash; `$(...)`/`&&` need fish ≥ 3.x). Paths containing `"`, `$`, backtick, `%`, `&` are not escaped. Java ignores `package` declarations and class≠file name (the Rust runner handles both; System B doesn't). **[Confirmed]**

**R6 — Tool resolution.**
* `PythonRunner` requires `python3` (and System B uses `python` on Windows, `python3` on Linux — inconsistent). On Windows, `python3` is often absent or the 0-byte Microsoft Store alias in `…\WindowsApps\`; `py` launcher is common. `detect_tools` already tries `python3, python, py`, so the Settings/Run panel can say "Python: Ready" while the runner would fail. **[Confirmed]**
* Rust resolves tools with `which` over **the app process's PATH**. A GUI app started from the Start menu / a Linux `.desktop` launcher does not get the PATH from `~/.bashrc`/`~/.profile` additions (`~/.cargo/bin`, `~/.local/bin`, nvm, SDKMAN, custom JDK dirs), and on Windows a PATH edited after login isn't seen until re-login. Dev mode (`npm run tauri dev` from a terminal) inherits the full interactive PATH ⇒ works on S's machine. **[Likely]** — the single most plausible dev-vs-installed difference for "tool not found".
* Install hints are one mixed string (Windows + Ubuntu) and the `shell` hint is `sudo apt install bash`. **[Confirmed]**

**R7 — No timeout/kill/cleanup on the active path.** `while(1)` hangs the PTY until the user types Ctrl+C; compiled artifacts are dropped *into the student's project folder* (`-o Main.exe`, `*.class`), contradicting README's "clean scratch builds". Closing the terminal tab does not kill the program. **[Confirmed]**

**R8 — Stale save before run.** Auto-save uses `active.isDirty`; combined with F6 (Ctrl+S can mark clean without writing the latest text), Run can execute **older code than on screen**. **[Likely]**

**R9 — Interactivity vs pipes.** The Rust runner uses pipes. A C/C++ program's `printf("Enter n: ")` without newline stays in the libc buffer (fully buffered when stdout is a pipe) so the prompt appears only at exit. `python -u` was added for exactly this reason, but C/C++ have no equivalent. So simply "switching the UI to System A" would make `scanf` programs look broken. A PTY (what System B uses) is the right *execution* surface for interactive student programs; System A is the right *build/resolve/diagnose* layer. **[Confirmed (C stdio behaviour is standard), design consequence]**

**Decision (see §8 for full plan).** Neither system "as is." Make **one** pipeline authoritative: Rust resolves tools and builds *argument vectors* (never shell strings) → compile phase captured for diagnostics → program is executed **directly in a PTY** (no intermediate shell) with timeout + kill, in the visible terminal. Delete the 16 frontend shell templates.

**Evidence still required.** Run matrix in §8.7 on 4 environments, including launch-from-shortcut vs launch-from-terminal and PATH-missing cases.

**Risks.** Largest change in this plan. Mitigation: Phase 0 hot-fixes (§18) make the current path safe even if the redesign slips.

---

### Problem 5 — Syntax highlighting missing in some installed environments

**Relevant files.** `main.tsx`, `languages/registerAllLanguages.ts`, `salivoMonaco.ts`, `MonacoEditorGroup.tsx`, `vite.config.ts`, `tauri.conf.json`, `useWorkspaceStore.ts#detectLanguage`.

**What the code proves**

* Monarch tokenizers run on the **main thread**; they need no web workers and no network. So worker/CSP problems **cannot** by themselves remove colours (they would break JSON/CSS/HTML/TS *language services*, not C/Java/Python colouring). **[Confirmed reasoning]** — this narrows the field.
* The app imports Monarch definitions from deep internal paths `node_modules/monaco-editor/esm/vs/languages/definitions/<lang>/<lang>.js` (relative `../../node_modules/...`). Internal layout changes between Monaco versions (it was `basic-languages/` historically; installed version is 0.56.0 per lockfile). If the path didn't exist the Vite build would fail, so for the committed lockfile it presumably exists — **but the code is coupled to a private layout** and `// @ts-ignore` hides typing. **[Confirmed fragility]**. The same `monaco-editor` entry already registers lazy built-in tokenizers for these languages, so this hand-registration may be redundant. **[Likely]**
* Registration happens three times (main/beforeMount/onMount). Registering re-sets the tokenization support for 17 languages and forces re-tokenisation of every open model on every editor mount. **[Confirmed]**
* `c` uses the C++ Monarch grammar (acceptable but not exact: e.g. `class`, `template` get keyword colours in C). **[Confirmed]**
* `language={file.language}` is passed per render, and a separate effect also calls `setModelLanguage`. `detectLanguage()` returns ids Monaco may not know (`toml`, `git`, `dockerfile`, `bat`, `lua`, `kotlin`, `swift`, `xml`, `salivo`, `zig` rely on built-ins/custom registration) → plain text for anything not registered. **[Confirmed]**
* `build.target: "esnext"` emits modern syntax unmodified. Monaco 0.56 itself is modern; older **WebKitGTK** (Ubuntu 22.04 ships 2.4x; labs often lag) or old WebView2 builds can fail on newer JS features. A hard parse error in `monaco-vendor` would make the **whole editor** blank, not just colourless — but a *partial* failure inside tokenizer setup (e.g., a regex feature unsupported by the engine → `setMonarchTokensProvider` throws, caught and `console.warn`ed by the try/catch in `registerAllEagerLanguages`) would yield exactly "plain text, no errors shown". **[Possible]** — this is the strongest "works on S's machine, not on others" candidate for the *colour-only* symptom, and it is cheap to test.
* The silent `try/catch + console.warn` around registration means a failure is invisible to users and to testers. **[Confirmed]**

**Root cause: [Unknown].** Candidates ranked: (1) tokenizer registration throwing on an older engine/other build difference and being swallowed; (2) duplicate registration/ordering weirdness between lazy built-in contribution and eager override; (3) theme/token mismatch (low: `vs-dark` base colours keywords anyway).

**Evidence still required** (one capture on a failing machine, §9.4): result of `monaco.languages.getLanguages()` for `c`, `monaco.editor.tokenize("int main(){return 0;}","c")`, the WebView version, and console warnings from `registerAllEagerLanguages`.

**Proposed fix.** §9. **Alternatives:** keep deep imports but pin Monaco exact version + CI import-path check (fallback); import public per-language contribution entry points; lazy-load only required languages.

**Risks.** Over-trimming languages. Do **not** remove languages until measured (brief requirement); first make registration single, observable, and verified.

---

### Problem 6 — Error highlighting missing

**Confirmed.** `MonacoEditorGroup` subscribes to `monaco.editor.onDidChangeMarkers` and counts errors/warnings for the status bar, but **nothing produces markers** for C/C++/Java/Python. (Monaco's built-in workers produce markers only for JS/TS/JSON/CSS/HTML.) The listener is also registered per mount and never disposed. There is no diagnostics module. **[Confirmed]**

**Proposed fix.** §10: compile/run output → pure TS parsers (gcc/g++/clang, javac, Python tracebacks) → `setModelMarkers`. No LSP.

**Risks.** Parsing fragility across compiler versions/locales (force `LC_ALL=C`/`LANG=C` for compile phase so messages are English and stable); Windows drive-letter colons in `file:line:col`.

---

### Additional findings that are not in the original six but affect them

* **F6 — Ctrl+S closure bug [Critical, Likely].** In `MonacoEditorGroup.onMount`, `editor.addCommand(CtrlCmd|KeyS, () => { onChangeContent(file.path, editor.getValue()); onSave(file.path); })` captures `file`, `onChangeContent`, `onSave` **from the render in which the editor mounted**. The editor instance is reused when the user switches tabs (same `key`), so afterwards:
  * `file.path` is still the *first* file's path → `onChangeContent(firstPath, currentEditorText)` **overwrites file A's in-memory content with file B's text**, then `onSave(firstPath)` writes it.
  * `onSave` is `saveFile`, a `useCallback([openFiles])` — the **mount-time** copy reads a stale `openFiles` snapshot, so even for the right file it can write the content from when the editor mounted.
  Whether the window-level Ctrl+S handler in `App.tsx` also fires depends on whether Monaco stops propagation for handled commands (it normally does) — so the buggy path is probably *the* path. **Test:** open A, open B, type in B, Ctrl+S, inspect A and B on disk. Same class of bug applies to `onCursorChange`/`onMarkersChange` closures (benign there).
* **F16 — main-thread blocking & PTY event flood.** In Tauri 2, commands declared as plain `fn` run on the main thread; `async` ones don't. `spawn_pty` (ConPTY creation on Windows can take hundreds of ms), `write_pty` (blocking write; the code's own comment describes the stall), `list_dir`, `search_files`, `find_files` are all plain `fn`. **[Likely — verify against Tauri docs for the pinned version]**. PTY reader emits one event per ≤8 KB read, unthrottled; a program printing in a loop floods IPC → React/xterm main-thread work. The System A runner batches (30 ms, 5 MB cap) — System B (what users get) does not.
* **F17 — line endings & save mechanism.** `readFile` rewrites `\r\n`→`\n`; saves write LF. Windows student files silently change EOL; harmless to compilers but surprising in diffs/other editors. `write_file` uses `.<name>.codeui-tmp` in the same folder + rename; on Windows, antivirus/OneDrive/Dropbox can briefly lock the target/tmp → intermittent save failure (swallowed by `console.error`). Also leaves a hidden temp file if the app dies mid-save.
* **F14 — lab-safe enforcement gap.** Options disable quick-suggest/parameter hints/inline suggest, but Monaco still ships TS/JS/JSON/CSS/HTML language services (completion providers reachable via Ctrl+Space, hover docs, JS/TS semantic diagnostics). The README's "NO AUTOCOMPLETE… EVER" is only partially enforced by option flags. **[Likely]** — test with `.js/.css/.html/.json` + Ctrl+Space + hover.
* **Settings not applied.** `settings.fontSize`/`tabWidth` are persisted but `MONACO_LAB_SAFE_OPTIONS` is a static object. **[Confirmed]** (not a stability bug; note for when options are touched.)

---

## 4. Packaged vs Development Investigation

### 4.1 What differs between "S's computer" and "an installed copy" (inventory, not conclusions)

| Axis | S's dev environment (inferred from code/paths — **[Unknown]** until confirmed) | Installed on another machine | Category |
|---|---|---|---|
| Default folder | `D:\JAVA` exists; `C:\Users\sahil\CodeUI` exists | Neither exists → explorer empty, PTY cwd silently ignored | **Application code** |
| Launch method | `npm run tauri dev` from a terminal → inherits interactive PATH, Vite dev server, DevTools | Start-menu/`.desktop`/AppImage → GUI-session PATH | Environment + app code |
| Compilers | gcc/g++/javac/python on PATH, probably Consolas + JetBrains Mono installed | Maybe absent; `python3` missing on Windows | Environment + dependency |
| Frontend bundle | Unbundled ESM, no minification, Monaco loaded per-module | Rollup `monaco-vendor` chunk, `target: esnext`, minified | Build/package |
| WebView | Latest WebView2 / dev's WebKitGTK | Whatever the lab has (older WebKitGTK, older/absent WebView2 runtime, no internet to bootstrap) | Environment / runtime |
| Fonts | System has Consolas / JetBrains Mono | Linux has neither | Environment + app code (not bundled) |
| Hardware | Fast dev machine | Slow lab PC / VM / software rendering | Environment |
| Build provenance | Local tree | CI-built from a tag; **two different `…x64-setup.exe` are committed** (6 514 910 vs 6 509 661 bytes, different SHA-256) | Release/package |
| Code revision | Working tree (maybe newer than release) | Whatever tag/artifact the user downloaded; app has **no build stamp** | Release/package |

> **Do not conclude** "works on S's machine ⇒ code is correct", nor "installer is broken" until §4.3 is done.

### 4.2 Tiny diagnostics feature (needed to make every later test objective)

Add **Help → Copy Diagnostics** (a Rust command `get_diagnostics` + a few JS fields). It must be added **first** (Implementation Phase 0). Output (plain text):

```
CodeUI version / git sha / build time / profile (debug|release) / target triple   <- baked in via build.rs (env!("CODEUI_GIT_SHA")) 
OS name+version, CPU arch, locale, display scale (devicePixelRatio), screen size
WebView: navigator.userAgent  (+ on Windows: WebView2 runtime version via tauri::webview_version())
Executable path, current_dir, settings file path
Process PATH (as seen by the app) and "login-shell PATH" (Unix, see §8.5)
Default shell + resolved path
Tool table: name → resolved path | NOT FOUND (python/py/python3, gcc, g++, clang, javac, java, …), plus --version output (run with 2 s timeout)
Fonts: document.fonts.check('14px "JetBrains Mono"'), computed font-family of .monaco-editor .view-line
Monaco: version, fontInfo (fontSize, typicalHalfwidthCharacterWidth, lineHeight), getLayoutInfo(), editors count, models count
Registered languages containing c/cpp/python/java; monaco.editor.tokenize("int x = 1;","c") token types
Counts: active PTY sessions (list_pty_sessions), registered Tauri event listeners (own counter)
```

### 4.3 Comparison procedure (do exactly this)

1. **Same commit, same artifact.** Build one commit with `npm run tauri build` on Windows and on Ubuntu 22.04; record SHA-256 of installers. Also build/run `npm run tauri dev` from that same commit. Compare **dev vs packaged on the same machine** first (isolates build/package differences), then **packaged on clean vs developer machine** (isolates environment).
2. On each of the 4 cells (Win-dev, Win-packaged, Ubuntu-dev, Ubuntu-packaged) capture §4.2 output, then run the test cases in §14.
3. **Launch matrix for packaged builds:** (a) from Start menu/desktop shortcut/`.desktop` file, (b) from an interactive terminal, (c) with a deliberately stripped PATH (`env -i HOME=$HOME DISPLAY=$DISPLAY ./CodeUI.AppImage`, or Windows: start from a shortcut after removing the compiler dir from PATH).
4. **WebView matrix** for rendering issues: default; Linux with `WEBKIT_DISABLE_COMPOSITING_MODE=1`; with `WEBKIT_DISABLE_DMABUF_RENDERER=1`; Windows with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu`. If any flag cures the corruption, that's H3 proven; then (and only then) decide whether to set the variable in `main.rs` on that platform.
5. **Open DevTools in a release build**: enable Tauri's `devtools` cargo feature in a *diagnostic-only* build/profile (never the shipped default) so console/Performance/Memory can be read on the failing machine.
6. **Record verdicts** in a table: each symptom → {application code | build/package | environment | dependency | OS | unknown}.

### 4.4 Bundle sanity checks (answers "Monaco instance duplication / worker loading / internal paths")

* `ls node_modules/monaco-editor/esm/vs/` — confirm whether `languages/definitions/` and/or `basic-languages/` exist in the resolved 0.56.0.
* `npx vite build` then list `dist/assets/`: exactly **one** monaco chunk containing `editor.main`; workers emitted as separate `*.worker-*.js`; `grep -c "defineTheme" dist/assets/*.js` should be 1 file.
* In the packaged app console: `monaco.editor.getEditors().length`, `monaco.editor.getModels().length`, and `window.MonacoEnvironment` defined **before** first model creation.
* `loader.config({monaco})` must execute before the first `<Editor>` mounts (it does: `main.tsx` before `render`); keep that order.

---

## 5. Editor Rendering Fix (implementation plan)

### 5.1 Instrument first (Phase 0) — answers "model vs view, layout vs font, main thread"

Add a small `src/services/diagnostics.ts` (dev/diagnostic builds and Copy Diagnostics) with:

```ts
// 1) content integrity: model vs what the user sees
const m = editor.getModel()!; 
({ lines: m.getLineCount(), len: m.getValueLength(), eol: m.getEOL() === "\n" ? "LF" : "CRLF" })
// 2) layout integrity
editor.getLayoutInfo();                       // contentWidth/Height, minimap, glyph margin…
editor.getContainerDomNode().getBoundingClientRect();
// 3) font integrity
editor.getOption(monaco.editor.EditorOption.fontInfo);  // typicalHalfwidthCharacterWidth, lineHeight
getComputedStyle(document.querySelector(".monaco-editor .view-line")!).fontFamily;
document.fonts.check('14px "<chosen font>"');
// measure one rendered line: width of span vs  (charCount * typicalHalfwidthCharacterWidth)
// 4) main-thread health
new PerformanceObserver(l => log(l.getEntries())).observe({ entryTypes: ["longtask"] });
// 5) leaks: monaco.editor.getEditors().length, getModels().length, own listener counters, performance.memory (Chromium only)
```

Interpretation table (use it during the soak test):

| Observation when corrupted | Meaning | Go to |
|---|---|---|
| `getValue()` has the right lines, DOM draws overlapped | Model fine, **view** broken | font/layout/GPU rows below |
| `fontInfo.typicalHalfwidthCharacterWidth` ≠ measured span width/char | **Font metric mismatch (H1)** | §5.3 |
| `getLayoutInfo().height` ≠ container rect height | **Layout (H4)** | §5.2 |
| long tasks >100 ms in a burst, CPU high in WebView process | **Main thread (H2)** | §5.6 + §16 |
| Healthy numbers, still garbled; fixed by compositing/GPU flag | **WebView GPU (H3)** | §4.3 step 4 |
| `getValue()` itself wrong (missing/merged lines) | **Model corruption** | stop; capture repro; check F6 and CRLF handling |

### 5.2 Layout: one mechanism, no timers

* Keep `automaticLayout: true` (ResizeObserver based) as the **only** automatic mechanism. Delete the rAF `layout()` effect on `file.path` and the `editor.layout()` in `onMount`.
* The only legitimate manual `layout()` calls: when a container goes from `display:none`/0×0 to visible (e.g., if the split pane or terminal drawer toggles visibility without resizing the editor's own box). Implement it with a `ResizeObserver` on the editor wrapper that calls `layout()` only if `contentRect` changed to a non-zero size — an event, not a timeout.
* Wrapper div: `min-width:0; min-height:0; overflow:hidden; position:relative` (already mostly there). Remove `.monaco-editor { touch-action: none }`.
* Verify with the matrix: resize window, drag sidebar, drag/open/close/maximise terminal panel, split on/off, tab switch, welcome↔file switch.

### 5.3 Fonts: make metrics deterministic

1. Ship a monospace font (OFL: JetBrains Mono Regular/Bold, or Cascadia Mono/DejaVu Sans Mono) as **woff2** under `src/assets/fonts/`, declared with `@font-face` (`font-display: block`), loaded through Vite so it is served from `'self'` (allowed by CSP `font-src 'self' data:`).
2. Single constant `EDITOR_FONT_STACK = '"CodeUI Mono", Consolas, "Cascadia Mono", "DejaVu Sans Mono", "Liberation Mono", monospace'` used for Monaco, xterm and CSS `--font-mono`.
3. **Gate the first `<Editor>`/xterm mount** on `await document.fonts.load('14px "CodeUI Mono"')` (a real readiness event; a short overall guard so a font failure never blocks the app — if it rejects, log it and continue with the fallback stack, then `monaco.editor.remeasureFonts()`).
4. After fonts resolve, call `monaco.editor.remeasureFonts()` once. Re-call it on `window` `resize` only if `devicePixelRatio` changed (monitor with `matchMedia('(resolution: Xdppx)')`) — DPI changes (moving window between monitors, 125→150 %) invalidate measurements.
5. Keep `disableLayerHinting` default; don't set `fontLigatures`. Keep `lineHeight` an integer that matches the font (21 is fine for 14 px).

### 5.4 Content ownership: make Monaco's model the source of truth (fixes F6, reduces per-keystroke work)

Minimal, contained change:

* `OpenFile` keeps `{ path, name, language, isDirty }` (+ `content` only as the *initial/disk* text). Remove `value={file.content}` + `onChange → updateFileContent(content)`.
* Use `<Editor path=… defaultValue={initialText} …/>`; models are created once per path.
* `onChange` → `markDirty(path)` **only if not already dirty** (one `setState`, not one per keystroke); `onDidChangeModelContent` already provides this signal.
* Save/Run/Preview/Search read text via `editorService.getText(path)` → `monaco.editor.getModel(Uri)?.getValue()` (fallback to disk text if no model, e.g. never-opened file).
* **Ctrl+S**: do not register a per-mount command with closures. Either (a) register once with `editor.addAction`/`addCommand` calling a **ref** to the latest handler (`saveRef.current(editor.getModel()!.uri.toString())`) or (b) let the window-level handler be authoritative and have Monaco pass the key through. In both cases the path comes from `editor.getModel()` (truth) not from React props.
* Same ref pattern for `onCursorChange`/`onMarkersChange`; and store the `onDidChangeMarkers` disposable and dispose it on unmount (today each mount leaks one global listener).
* Re-enable `saveViewState` (cursor + scroll per tab) — compatible with `keepCurrentModel`.
* **Do not unmount the Monaco group** when Welcome/Extension tabs are shown; render them as an overlay/sibling and hide the editor with `visibility:hidden` or move it off-flow while keeping it mounted (then `automaticLayout` still works because size is retained). This removes remount churn, caret loss, repeated language registration and listener leaks.
* `closeFile` → `editorService.disposeModel(path)` (already exists) — keep, and also dispose on delete/rename.

### 5.5 Language registration (rendering/CPU side)

* Register **once** (at startup in `main.tsx`), remove the `beforeMount`/`onMount` calls. Make it idempotent with a module-level flag.
* Do not remove languages yet (brief). Measure registration time and first-tokenize time in the diagnostics capture; only trim if numbers justify.
* Consider importing `monaco-editor/esm/vs/editor/editor.api` + only needed contributions instead of the full `monaco-editor` entry **only if** the §16 numbers show startup/memory problems; it also helps F14 (drops TS/CSS/HTML/JSON services).

### 5.6 Main-thread relief (supports H2)

* Mark heavy/blocking Rust commands `async` (or `#[tauri::command(async)]`) so they run off the main thread: `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`, `list_dir`, `read_file`, `write_file`, `search_files`, `find_files`, `create_*`, `rename_file`, `delete_file`. (Verify the pinned Tauri 2.x docs; this is a mechanical, low-risk change.)
* Batch PTY output in Rust like the runner does: coalesce reads for ≤16–30 ms or ≥8 KB, cap the per-session pending queue, and emit one event per batch. In xterm, write batches (already chunked); optionally apply `term.write(data, cb)` back-pressure.
* After the §5.4 change, typing no longer re-renders `App`. (If anything still renders per keystroke, wrap shell components in `React.memo`.)
* A/B experiments (not defaults): `minimap.enabled=false`, `smoothScrolling=false`, `cursorSmoothCaretAnimation=off` — record whether they change the failure rate before deciding.

### 5.7 Acceptance for this section

See §17 "Editor". Specifically: no overlap after 60 min soak on both OS, packaged and dev; `getEditors().length` constant; `getModels().length == open files`; zero long tasks >200 ms during typing; layout correct after each action in the matrix.

---

## 6. Cursor Visibility Fix

### 6.1 Monaco

1. Theme `codeui-dark` colours: add
   `"editorCursor.foreground": "#FFFFFF"`, `"editorCursor.background": "#1e1e1e"`, and (for contrast) `"editor.selectionBackground": "#264f78"`, `"editor.inactiveSelectionBackground": "#3a3d41"`. Options: `cursorStyle: "line"`, `cursorWidth: 2`, keep `cursorBlinking: "solid"` (or `"blink"` if desired — solid is the safest for visibility).
2. **Focus ownership.** Introduce a tiny `focusService` (or store field `focusTarget: "editor" | "terminal" | "explorer"`):
   * After `openFileByPath` (new tab or existing), after `createNewFile`, after tab switch from tab strip/Ctrl+Tab, after closing the terminal panel, and after leaving Welcome/Extension → `editorService.focusActive()` **if** `focusTarget === "editor"`.
   * Implement as an effect inside `MonacoEditorGroup` keyed on the model path: `useEffect(() => { editor?.focus() }, [path, focusNonce])` — a real lifecycle hook (path change after the wrapper has switched model), not a timer.
   * After Run: `focusTarget = "terminal"`; terminal grabs focus when its xterm reports ready (§6.2).
3. Re-enable `saveViewState`; remove the remount-on-Welcome behaviour (§5.4) so caret/scroll persist.
4. CSS cleanup: remove `.monaco-editor { touch-action: none }` unless proven needed; keep `.monaco-editor .inputarea { user-select: text }`.
5. Verify in DevTools that `.monaco-editor .cursors-layer .cursor` exists, has non-zero width/height, and its computed background equals the theme colour; verify `document.activeElement` is `textarea.inputarea` after each §14 step.

### 6.2 xterm

1. **Do not unmount the terminal on panel close / tab switch.** Keep `TerminalPanel` mounted (hidden with `display:none` when not visible) *or* hoist the `Terminal` instance into a module (`terminalService`) and re-`open()` it into the container on show. This preserves buffer, prompt and cursor. On show: `ResizeObserver` → `fit()` only when `clientWidth>0 && clientHeight>0`, then `resizePty`.
2. If true unmount is retained for any reason, add **Rust-side scrollback**: keep the last ~64 KB of output per session; `attach_pty(id)` returns the snapshot, then live events continue (sequence numbers to avoid duplication). This also fixes listener-race output loss (R2).
3. **Ready-based focus.** After `term.open()` + first successful `fit()` + `spawn_pty` resolved (or `attach` resolved) → `term.focus()`. Replace `setTimeout(...60)` / `setTimeout(...100)` with these events. Remove the immediate `term.focus()` right after `open()` and the `window "focus-terminal"` + 100 ms hop — call `terminalService.focus()` from the Run flow after the terminal reports ready.
4. Options: keep `cursorBlink: true`, `cursorStyle: "bar"`, `cursorInactiveStyle: "bar"`, `cursorWidth: 2`; set theme `cursor`/`cursorAccent` (already). **Delete** the dead `.xterm-cursor-layer` CSS and the `!important` cursor overrides; if after cleanup the cursor is still invisible in a packaged build, inspect the DOM renderer element (`.xterm-cursor.xterm-cursor-bar`) and style *that* (e.g. `--xterm-bar-cursor-width`/box-shadow) — do not guess.
5. `convertEol: true` is wrong for a real PTY (it already sends CRLF; `\n`-only output from programs written for Unix terminals is translated by the line discipline). Set `false` unless a test shows missing carriage returns.
6. `fit()` handling: the `ResizeObserver` + `resizePty` already exist — keep, but guard zero-size and de-dupe identical cols/rows to avoid resize storms.

### 6.3 Acceptance test (both editor & terminal)

Click → visible caret · type → caret stays · arrow keys → caret moves · switch file → caret visible without clicking · switch Terminal↔Preview↔Terminal → prompt and caret still there · resize window/panel → caret visible · Run an interactive program → terminal caret visible and accepts input.

---

## 7. Filesystem / Explorer Fix

### 7.1 Principles

* **One source of truth** for the tree: move `expandedFolders`, `folderContents` (rename: `dirCache: Map<path, FileEntry[]>`), `loadingFolders` out of `FileTree` into the workspace store.
* **One code path for all depths**: store actions take absolute paths; the UI never branches on `parentPath === workspacePath`.
* **Refresh only the affected parent dir(s)** after each op; invalidate cache entries under a renamed/deleted path.
* **Open tabs are updated by the same action** that changes the filesystem.
* **Every failure is shown to the user** (§7.5).

### 7.2 Path utilities (`src/utils/path.ts`, pure + Vitest tests)

```ts
sepOf(p): "\\" | "/"             // from the path itself (drive letter / backslash ⇒ "\\")
join(parent, name)               // never double separators
dirname(p) / basename(p)
isInside(child, ancestor)        // normalised compare; case-insensitive on Windows paths
rebase(p, oldPrefix, newPrefix)  // for folder renames
validateName(name): string | null  // returns user-facing error or null
```

`validateName`: reject empty, `.`/`..`, any of `\ / : * ? " < > |` and control chars, trailing space/dot (Windows), Windows reserved names (`CON, PRN, AUX, NUL, COM1–9, LPT1–9`), length > 255. Also add a Rust-side check (defence in depth) so `create_file`/`create_dir`/`rename_file` reject a *name* that contains a separator (today they accept `a/b` and `create_dir_all`).

### 7.3 Store actions

```ts
createEntry(parentDir: string, name: string, kind: "file"|"folder")
  → validate → fsService.create* → refreshDir(parentDir) → expand(parentDir)
  → if file: openFileByPath(newPath) + focus editor
renameEntry(oldPath: string, newName: string)
  → validate → fsService.renameFile
  → refreshDir(dirname(old)); invalidate cache under old
  → for every open tab where p === old || isInside(p, old):
        capture model text (dirty preserved) → dispose old model → tab.path = rebase(...); tab.name; tab.language = detectLanguage(newName)
        → editor opens new path with that text (language re-detected so highlighting survives rename)
  → keep activeFilePath/split path mapped via rebase
deleteEntry(path)
  → confirm via in-app dialog (§7.4) → fsService.deleteFile
  → close every open tab where p === path || isInside(p, path) (dispose models); choose a valid next active tab
  → refreshDir(dirname(path)); invalidate cache under path
refreshDir(path) / refreshAll()   // cancel stale responses with a request token per path
```

* `openFileByPath` and others must stop closing over `openFiles`: use `setOpenFiles(prev => …)` and `useRef` mirrors, or move to a `useReducer`. Fixes duplicates/skips (finding 6).
* Startup race (finding 9): load settings **before** choosing the initial workspace; use a request token so only the latest `listDir` result is applied; do not `listDir` a path that doesn't exist (see §7.6).
* **Dirty rename policy:** rename keeps unsaved text (never re-reads disk). **Dirty delete:** the delete confirmation states that unsaved changes in open tabs under that path will be discarded.
* Keep the existing Rust commands; changes there are limited to name validation (§7.2) and `async` (§5.6). Optionally add a `fs_move`/`fs_copy` later — not now.

### 7.4 UI changes

* Replace `window.prompt` (New File via Ctrl+N/menu/walkthrough) and `window.confirm` (Delete) and `alert` with **in-app** UI: the explorer already has inline rename/create inputs — reuse them for New File/Folder; use a small modal for delete confirmation. This removes the platform-dependence (F11). If the team wants to keep native dialogs, add `tauri-plugin-dialog` (`ask`/`message`) instead — also acceptable; do not leave `window.*` dialogs.
* New file from menu with no folder context → create in the workspace root.
* After creating a folder: expand the parent and show the new folder (not auto-expand the new folder).

### 7.5 Error reporting (lightweight)

* `src/services/notify.ts` + `<Toasts/>` (≈40 lines): `notify.error(title, detail)`, auto-dismiss ~6 s, errors persist until clicked; also mirrored into the status bar message area. No modal for routine failures.
* `formatError(err)` normalises Rust `{kind,message}` objects, strings and `Error`s: e.g. `Could not create file: permission denied: C:\…\x.c`.
* Every `catch { console.error }` in store/FileTree/App becomes `notify.error(...)` (keep `console.error` too).
* Messages follow the brief: "Could not create file: Permission denied", "Could not run this file. Reason: Python 3 was not found."

### 7.6 First-run / bad workspace behaviour

* Remove `"D:\\JAVA"` and `"C:\\Users\\sahil\\CodeUI"` from the store, initial `settings`, mock fs and mock PTY. Default state = **no workspace** (Welcome screen with "Open Folder"/recents).
* On start, if `lastFolder` doesn't exist (`path_exists`) → clear it and show a one-line toast ("Last folder is no longer available"); never show a silently empty explorer.
* PTY `cwd`: if the requested directory doesn't exist, **return an error/notice** instead of silently falling back to the home directory.

### 7.7 Test cases

Matrix at three depths: root, `src`, `src/utils`: create file/folder · rename file · rename folder (with open dirty file inside) · delete file · delete folder (with open tabs inside) · name collisions · invalid names · names with spaces/unicode · read-only folder → toast text.

---

## 8. Run System Fix

### 8.1 Decision on the duplicate execution architecture

| Question | Answer |
|---|---|
| Which path is authoritative? | **The Rust runner layer (System A)**, extended. |
| Should System B (frontend shell templates in `runActiveFile`) remain? | **No.** Remove all 16 templates after A works. A plain terminal remains a plain terminal. |
| Do they serve different purposes? | No — they overlap; B is strictly less capable (no timeout, no Java package/class detection, no stdin control, writes artifacts into the project, shell-dialect fragile). |
| Does duplication cause inconsistent behaviour? | Yes: README promises timeouts/cleanup/clean scratch that users never get; `python3` vs `python` differs between paths; detection and execution use different rules. |
| How do interactive programs get stdin? | **Run the program in a PTY, spawned directly from Rust (no shell).** Compile phase remains piped & captured (for diagnostics). |

### 8.2 Target flow

```
Run (F5 / button)
  1. save: await editorService.getText(path) → fsService.writeFile  (always, not only when dirty)  
  2. frontend creates runId (uuid) and **subscribes first**: listen run-status-{id}, run-output-{id}, pty-data-{id}
  3. invoke run_file(path, runId, cols, rows, timeoutSecs)
       Rust: runner_for(ext) → resolve tools (augmented PATH, §8.5) → build CommandSpec (argv, cwd, env)
             compile (piped, LC_ALL=C, batched, capped)  → emits status Compiling / CompileFailed / output chunks
             execute: portable-pty spawn of the program itself (argv, cwd=file dir, TERM, env), registered under runId
             watchdog: timeout → kill process tree; Stop button → kill; window close → kill (already in shutdown_all)
  4. Frontend shows compile output + program I/O in the Terminal panel's "Run" tab (xterm bound to pty-data-{runId}); 
     stdin = typed keys → write_pty(runId) ; Ctrl+C = \x03 ; Stop button → stop_run
  5. On exit: status Finished {exitCode, hint, durationMs} → footer line "[Process exited with code 0 in 123 ms]"
```

Notes:
* The user's normal shell tab stays unrelated (a plain terminal). The Run tab is a second xterm instance (re-use one terminal component with a `sessionId` prop) — **or** the Run output is shown in the same terminal after a visual separator; choose whichever is simpler, but **never inject typed commands into the user's shell**.
* Build artifacts go to the existing per-run scratch dir (temp), not the project folder. Remove them after the run (existing behaviour in `finish`). For Java, keep `-d scratch` and `-cp scratch` (already implemented) and the existing package/class detection.
* **Keep** the already-tested Rust pieces: `kill_tree`, `OutputBudget`, `take_utf8`, Java detection, tests in `runner_pipeline.rs`. Extend rather than rewrite.
* `run_file` must accept a **caller-provided `run_id`** (same pattern the PTY already uses) so listeners exist before the first event (fixes R2). Alternatively buffer events in Rust until the first `attach`.
* Non-core languages (Rust, Go, JS, TS, Ruby, PHP, Lua, C#, shell, PowerShell, bat, Zig): replace the shell templates with a **data table** in Rust (`SimpleRunner { ext, tool candidates, args template }`) → ~40 lines, same flow. For `ts`, don't use `npx ts-node` (network/first-run side effects) — mark unsupported unless `ts-node`/`tsx` is on PATH. HTML keeps the Preview behaviour.

### 8.3 Process execution details

* Unix: spawn via portable-pty (child is a session leader) and kill with `killpg` on stop/timeout; Windows: portable-pty/ConPTY child + `taskkill /T /F` (or job object) to take the tree — **verify** the existing `kill_tree` semantics on Windows because it was written for pipe children.
* Timeout default 12 s (existing setting `runTimeoutSecs`); surface the message "Program ran longer than N seconds and was stopped." Add a visible **Stop** button and make Ctrl+C work in the Run tab.
* Output flood protection: reuse `FLUSH_INTERVAL`/`OUTPUT_CAP` batching on the PTY reader (same code benefits Problem 1 H2).
* Duplicate-ID protection in `PtyManager::spawn`: **reject** (`PtyError::AlreadyExists`) instead of overwriting; kill session on `kill_pty`; emit exit event once.
* Wait for readiness without sleeps only where a shell is involved (user terminal): first `pty-data` event or an OSC marker; for direct program spawn there is no shell to wait for.

### 8.4 Error messages (user-facing; no AI text)

| Situation | Message (toast + terminal line) |
|---|---|
| gcc missing | `GCC was not found. Install GCC (Windows: MinGW-w64/MSYS2; Ubuntu: sudo apt install build-essential) and try again.` (use the OS-specific hint) |
| Python missing | `Could not run this file. Reason: Python 3 was not found.` + hint |
| javac missing / java missing | same pattern, separate tools |
| Java class/file mismatch | existing precise message from `JavaRunner` |
| Compile error | raw compiler output in terminal + markers (§10); status "Compilation failed (exit N)" |
| Runtime error | program's stderr + exit code + `crash_hint` |
| Timeout | existing hint string |

### 8.5 Tool resolution & PATH (fixes R6)

Create `src-tauri/src/proc/toolpath.rs`:

* `augmented_path() -> OsString`: process PATH **plus**
  * Unix: PATH captured once from the user's login shell (`$SHELL -lc 'printf %s "$PATH"'`, 2 s timeout, ignore failure) + `~/.local/bin`, `~/.cargo/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/snap/bin`, `$JAVA_HOME/bin`.
  * Windows: PATH re-read from the registry (HKCU\Environment + HKLM\…\Session Manager\Environment) so a PATH edited after login works after a "Refresh tools" click; plus `%JAVA_HOME%\bin` and common MinGW/MSYS2 locations (`C:\msys64\ucrt64\bin`, `C:\msys64\mingw64\bin`, `C:\MinGW\bin`, `C:\Program Files\LLVM\bin`).
* `resolve(candidates: &[&str]) -> Option<ResolvedTool>` using `which::which_in` over `augmented_path()`; **skip** Windows Store stubs (`…\Microsoft\WindowsApps\python*.exe` that are 0-byte reparse aliases); return the absolute path.
* Python candidates (ordered): Windows `python`, `py` (use `py -3`), `python3`; Unix `python3`, `python`. Runner and `detect_tools` **must call the same function**.
* gcc: `gcc`, then `clang` (if clang chosen use clang flags/ name); g++: `g++`, `clang++`. Java: `javac`/`java`, then `$JAVA_HOME/bin`.
* All spawned children (compile, execute, PTY shells) get `PATH=<augmented>` explicitly.
* `detect_tools` returns per-OS install hints (`#[cfg]`), not a mixed string; the `shell` entry's hint must not say `apt` on Windows. Expose a **Refresh** that really re-resolves (and re-reads the registry).
* `detect_tools` and `which` are cheap but synchronous — mark `async`.

### 8.6 Interim hot-fixes (Phase 0, only if the redesign cannot land together)

If the team wants a quick, safe improvement of the *current* path before the redesign:
1. Make `ensurePtySession` single-flight with a `useRef<Promise<string>>` (not state) and have `TerminalPanel` take the session from the store instead of choosing its own id; reject duplicate ids in Rust.
2. Windows templates: capture status immediately: `javac "F"; $ok=$?; $ms=…; if ($ok) {…}` or `if ($LASTEXITCODE -eq 0)`.
3. Windows python: try `py -3` / `python`; Linux python3.
4. Don't write the command until the first `pty-data` has arrived.
Do **not** invest further in B beyond this.

### 8.7 Required run test matrix

Each cell: Windows-dev, Windows-packaged, Ubuntu-dev, Ubuntu-packaged × launch (shortcut / terminal / stripped PATH).

| Lang | Cases |
|---|---|
| **C** | `hello.c`; `scanf` input (prompt without newline must appear before input); compile error (marker + message); runtime error (null deref → hint); infinite loop (stops at timeout; process gone); path with spaces; path with unicode; file in nested folder |
| **C++** | same categories; `cin`/`cout` prompt; `-std` default OK |
| **Python** | `python3`-only machine; `python`-only machine (Windows); `py` launcher only; Store-stub-only machine (must say "not found", not hang); `input()`; runtime traceback; syntax error |
| **Java** | `Main.java`; public class ≠ filename (clear message); `package com.x;` source; `Scanner(System.in)`; compile error; runtime exception; two classes in one file |
| **Env** | tool installed + PATH correct · installed + PATH missing (must still be found via augmentation or give a precise message) · absent · fresh install · dev mode · packaged · launched from terminal vs shortcut |

Each failure must be attributable to exactly one of: {Run button, PTY, runner, PATH, compiler missing, packaging env} — the diagnostics text must say which.

---

## 9. Syntax Highlighting Fix

### 9.1 Plan

1. **Verify before changing.** On a failing machine run the §4.2 capture (languages list + `monaco.editor.tokenize`). On a working machine do the same; diff.
2. **Single registration point**, idempotent, observable: `registerLanguages(monaco)` called once from `main.tsx` *before* `loader.config`; returns `{ registered: string[], failed: {id, error}[] }`; failures are **logged to the app log and shown in Copy Diagnostics** (no silent `console.warn`).
3. **Prefer Monaco's own contributions** (the full `monaco-editor` import already registers and lazily loads c/cpp/java/python/… tokenizers). Test a branch with the hand-registration of *core* languages removed; if tokenization is identical, delete the deep imports (`esm/vs/languages/definitions/...`) and the `@ts-ignore`s. Keep custom definitions only for what Monaco lacks (Salivo, Zig).
4. If the deep imports must stay: pin `monaco-editor` to an exact version (`"0.56.0"`, no caret), and add a CI step `node -e "require('fs').accessSync('node_modules/monaco-editor/esm/vs/languages/definitions/cpp/cpp.js')"`-style guard so a layout change fails CI instead of production.
5. **Grammar choice for C:** use the dedicated C grammar if present in the resolved Monaco; otherwise cpp grammar is acceptable.
6. **Language IDs:** make `detectLanguage` return only ids that are registered (`monaco.languages.getLanguages()`), else `plaintext`. Re-run `detectLanguage` on rename (§7.3) and on save (already done). Unify with `registerAllLanguages` extension lists (single table).
7. **Build target.** Replace `target: "esnext"` with a Tauri-appropriate target (`chrome105` for Windows/WebView2, `safari13`/`es2021` for WebKitGTK — Tauri's recommended defaults) and test Monaco 0.56 builds/runs under it on Ubuntu 22.04. If Monaco requires newer syntax, document the minimum WebKitGTK/WebView2 versions instead and add an in-app startup check that shows "Your system WebView is too old (version X)" rather than a blank/plain editor.
8. Theme: keep `codeui-dark` rules (prefix-matched), `inherit: true` so base `vs-dark` colours remain as the fallback.
9. No eager importing of the TS/JSON/CSS/HTML **workers** unless those languages need their services (see §10/F14); Monarch grammars for html/css/js/ts/json are enough for colour. Worker removal is optional and must be measured.

### 9.2 Acceptance test files

`test.c  test.cpp  test.py  Main.java  index.html  style.css  script.js` → keywords, strings, comments, numbers, operators/delimiters coloured; still coloured after tab switch, save, rename (e.g. `test.c`→`test2.c`), app restart, and on a fresh packaged install on another machine.

### 9.3 Automated guard

A debug-only self-test (called from Copy Diagnostics and a Vitest-in-browser or Playwright-less smoke command): for each core language tokenize a one-line sample and assert at least one token type starting with `keyword` and one with `string`/`comment`/`number` as appropriate. A failing assertion is printed in the diagnostics report.

### 9.4 Capture list (for the failing machine)

`monaco.languages.getLanguages().filter(l=>['c','cpp','python','java'].includes(l.id))`, `monaco.editor.tokenize(sample,'c')`, console warnings from registration, `navigator.userAgent`, whether `window.MonacoEnvironment` was set before first model, and whether `Editor` gets `language` equal to the registered id.

---

## 10. Error Diagnostic / Error Highlighting Fix

**Two separate things:** syntax *colouring* (§9) vs *diagnostics* (this section). v0.1 scope = **compile/run-time diagnostics only, no LSP, no live-as-you-type analysis.**

### 10.1 Pipeline

```
Run → Rust compile phase (LC_ALL=C, piped, batched) → stderr text
    → frontend `parseDiagnostics(language, text, sourcePath)` (pure TS)
    → monaco.editor.setModelMarkers(model, "codeui-compiler", markers)
    → red squiggle + overview ruler + status-bar counts (existing onDidChangeMarkers counter) + clickable list (optional)
```

### 10.2 Parsers (`src/services/diagnostics.ts` + Vitest fixtures)

* **gcc / g++ / clang:** `^(?<file>.+?):(?<line>\d+):(?<col>\d+): (?<sev>error|warning|note|fatal error): (?<msg>.*)$` — the lazy `.+?` plus mandatory `:\d+:\d+:` handles Windows `C:\dir\x.c:12:5:`. `note` lines attach to the previous diagnostic. Map to `MarkerSeverity.Error/Warning/Info`. Use the column and, if the compiler printed a caret/range line, extend to the token end; otherwise highlight the word at that column (`model.getWordAtPosition`) or the rest of the line.
* **javac:** `^(?<file>.+\.java):(?<line>\d+): (?<sev>error|warning): (?<msg>.*)$`; the following source line + `^` line gives the column (index of `^`).
* **Python:** (a) syntax error: parse the traceback block `File "<path>", line N` + `SyntaxError: msg` (+ caret position when printed); (b) runtime: choose the **last** frame whose file is the user's file → marker at that line with the exception line as message.
* Only accept diagnostics whose `file` resolves to the file being run (compare normalised paths; scratch copies must be mapped back). Multi-file projects: set markers on whichever open model matches; ignore others.
* Matching is robust to Windows/Unix separators via the `path.ts` utilities.

### 10.3 Marker lifecycle

* `setModelMarkers(model, "codeui-compiler", [])` at the start of every Run.
* Clear that owner's markers on the first edit after a run (stale squiggles on shifted lines are worse than none) — state it in the UI (“Diagnostics from last run”).
* Dispose the `onDidChangeMarkers` listener on unmount (leak fixed in §5.4).
* Status bar count = Monaco markers for the active model (existing code path, once listener is fixed).

### 10.4 Out of scope / constraints

No suggestions, quick-fixes, "explain" or AI text. Messages are the compiler's own text. Lightbulb/code actions stay disabled (`lightbulb.enabled: off`; verify the current option value type — it is cast `as unknown as undefined` in `monacoSafeDefaults.ts` and should be rechecked against the 0.56 option enum).

### 10.5 F14 — enforce "no assistance" for built-in language services

* Disable Monaco's built-in services that provide assistance: `monaco.languages.typescript.javascriptDefaults/typescriptDefaults.setModeConfiguration({ completionItems:false, hovers:false, signatureHelp:false, documentSymbols:false, … })`, and the equivalent `setModeConfiguration` for `css/scss/less`, `html`, `json` (`completionItems:false`, `hovers:false`). Keep colouring and (optionally) diagnostics.
* Override the manual trigger: `editor.addCommand(KeyMod.CtrlCmd|KeyCode.Space, () => {})` and the `editor.action.triggerSuggest`/`editor.action.showHover`/`editor.action.triggerParameterHints` actions, or set `suggest.enabled`-equivalent via option set that exists in 0.56 (verify names in the typings before use).
* Test with `.js/.css/.html/.json` + Ctrl+Space + hover + `.` trigger: nothing must pop up. Add this to the manual regression list (§15).
* If bundle analysis shows the TS worker is unused after this, remove `tsWorker` import in `main.tsx` (saves multi-MB), but only after the check.

---

## 11. Windows Compatibility

* **Shell:** default `powershell.exe` (5.1) else `COMSPEC`. Don't build PowerShell-syntax strings anymore (§8). Pass `-NoLogo`; consider `-NoProfile` for the *Run* path only (not used after redesign); keep the user's normal profile for the interactive terminal.
* **Paths:** drive letters + backslashes; UNC paths; spaces; Unicode usernames; paths > 260 chars (long-path manifest is not enabled by default in Rust std on older Windows — document); case-insensitive comparison in `isInside`/open-tab de-dupe; normalise the Monaco URI (`getNormalizedUri` currently doesn't percent-encode: spaces, `#`, `%`, `?` in a path can produce a mismatched/lossy URI — use `monaco.Uri.file(path)` and compare via `uri.toString()` / `uri.fsPath`).
* **Executables:** MinGW `gcc -o foo` yields `foo.exe` — runner already uses scratch paths; assert on actual produced path (check for `.exe` suffix) rather than assuming. Skip Store `python` stubs. `py -3` launcher. `javac` from JDK vs JRE-only installs (JRE has `java` but not `javac` → precise message).
* **Process tree kill:** verify `kill_tree` (Unix signal-based) actually terminates grandchildren on Windows; implement `taskkill /PID <pid> /T /F` or a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
* **ConPTY:** requires Windows 10 1809+. Keep `slave` handle alive (already done). Initial size should be passed at spawn (today `cols/rows` are omitted by the Run path → 80×24 then resized) to avoid reflow garbage.
* **WebView2:** `embedBootstrapper` downloads the runtime at install time (fails on offline labs). Decide between `offlineInstaller` (~+130 MB) / `fixedRuntime` / documenting a pre-installed runtime (§13). Windows 10 labs without WebView2 will otherwise show a blank window or installer error.
* **Defender/OneDrive:** temp-file+rename saves can transiently fail → retry once with short backoff on `PermissionDenied`/sharing-violation, then toast the error.
* **Line endings:** decide policy (preserve file's original EOL; set Monaco `files`-like EOL from the first line ending detected) — see F17.
* **Titlebar:** `decorations:false` custom titlebar: verify drag, snap, DPI scaling and that window controls work in the packaged build (capabilities list is explicit).
* **SmartScreen:** unsigned installer triggers warnings; document or sign.

## 12. Ubuntu / Linux Compatibility

* **Baseline:** Release builds on `ubuntu-22.04` ⇒ needs glibc ≥ 2.35 and `libwebkit2gtk-4.1`. **Ubuntu 20.04 labs cannot run this build at all** (no 4.1 package). Decide supported matrix (22.04 / 24.04) and state it in README. **[Unknown]** which versions the target labs use.
* **AppImage:** needs FUSE: Ubuntu 22.04 has `libfuse2`; **24.04 does not** by default (`sudo apt install libfuse2t64`) or run with `--appimage-extract-and-run`. Document it; the release workflow installs `libfuse2` for building only.
* **.deb:** `deb.depends: []` in `tauri.conf.json` — verify with `dpkg -I` that webkit2gtk-4.1 and gtk deps are still emitted automatically; if not, list them.
* **GUI PATH:** `.desktop` launchers don't source `~/.bashrc`. Use the login-shell PATH capture (§8.5). Test both `./CodeUI.AppImage` from terminal and double-click from file manager.
* **Shells:** `$SHELL` may be zsh/fish/dash; after the redesign Run doesn't depend on shell syntax. The interactive terminal should start the user's shell as a login/interactive shell consistently (decide `-l`), set `TERM=xterm-256color` (done) and `COLORTERM=truecolor`.
* **Rendering/GPU:** WebKitGTK issues on VMs/NVIDIA: keep the §4.3 env-flag experiments; if one is needed, set it in `main.rs` **before** the webview is created, on Linux only, with a note and a user override.
* **Fonts:** bundle the monospace font (§5.3); fontconfig differences vanish.
* **Permissions:** project dirs on shared lab machines (read-only, NFS, quotas): errors must reach the user (§7.5); temp dir for scratch may be `noexec` on hardened lab images — if the compiled binary fails with "Permission denied", fall back to a per-user dir under `~/.cache/codeui/run/<id>` (**[Possible]**, test).
* **Process isolation:** `setsid` already used for runner; direct PTY spawn is session leader; confirm `killpg` after timeout and that no processes remain (CI already greps `pgrep -f 'codeui-'`).
* **Settings path:** `dirs::config_dir()` ⇒ `~/.config/codeui/settings.json`; on lab machines with read-only/network homes, writes may fail → toast + in-memory fallback.

---

## 13. Packaging / Release Reliability

**Findings (all Confirmed unless noted)**

* `installer/` and `installers/` both contain `CodeUI_0.1.0_x64-setup.exe` with **different sizes and SHA-256** (6 514 910 B vs 6 509 661 B). They cannot both be "the v0.1.0 installer." `installer/README.md` links to the one in `installer/` plus an AppImage on release tag `v0.1.0-1`; the root README links to `releases/latest`. The `.deb`/`.dmg` exist only in `installer/`. `README` claims the Windows exe is "~1.5 MB" (it's ~6.5 MB).
* Release workflow: on `workflow_dispatch` the tag becomes `v0.1.0-<run_number>` (so many different "0.1.0" builds); the app's own version is always `0.1.0`; the app has **no commit/build stamp**, so nobody can tell which build a tester is running — consistent with "S's build and installed build may differ."
* The release body lists `codeui___VERSION___amd64.AppImage` (lowercase) but real artifact names are `CodeUI_0.1.0_amd64.AppImage` → broken doc links.
* No checksums are published. CI (`ci.yml`) never runs `tauri build`, never launches the packaged app, and runs only on `ubuntu-latest` (no Windows PTY/path tests). CI installs `libappindicator3-dev` but the release installs `libayatana-appindicator3-dev`.
* `webviewInstallMode: embedBootstrapper` ⇒ needs internet on Windows machines lacking WebView2.
* `vite build` `target: esnext` (see §9).

**Plan**

1. **Delete `installer/` and `installers/` binaries from the repository** (git history will keep them; add to `.gitignore`); distribute only via GitHub Releases. Fix READMEs to point to the Release page; remove the wrong "1.5 MB" claim.
2. **Build stamp:** `build.rs` sets `CODEUI_GIT_SHA`, `CODEUI_BUILD_TIME`, `CODEUI_PROFILE`; show in Help → About, status bar tooltip and Copy Diagnostics. Version bumps via the existing `xtask bump` (also bump when cutting a new build, e.g. `0.1.1`) so artifacts are distinguishable by name.
3. **Release workflow:** tag-only releases (drop the `v0.1.0-<run>` fallback or make it a draft pre-release); `releaseDraft: true` until the QA matrix (§14) passes on the actual artifacts, then publish. Add a job step that computes `SHA256SUMS.txt` for every bundle and uploads it to the release; document `sha256sum -c` / `Get-FileHash` verification in README. Fix artifact names in the release body.
4. **CI additions:** `windows-latest` job running `cargo test --workspace` (+ `npm ci && npm run build`); an Ubuntu job that builds the `.deb` (`tauri build --bundles deb`) on PRs to `main`; an artifact-content check (the built `dist/` contains exactly one `monaco-vendor` chunk and the font file); an import-path guard (§9). Optional: `xvfb-run` smoke launch with a `--self-test` flag that prints diagnostics and exits 0.
5. **Same-commit guarantee:** the tag → CI → tauri-action build already produces frontend and Rust from one checkout; the stamp (step 2) is what lets you *prove* it. Add `npm ci` (already) and commit `package-lock.json`/`Cargo.lock` (already) — keep pinned.
6. **Dependencies documented** in README: Windows (WebView2 runtime, MinGW-w64/MSYS2 for C/C++, Python 3 with `py` launcher, JDK), Ubuntu (22.04+, `build-essential`, `python3`, `default-jdk`, `libfuse2(t64)` for AppImage). In-app "Tools" panel must reflect exactly what Run will use (shared resolver, §8.5).
7. **WebView2 policy:** pick offline installer or document pre-install for labs (open question Q3).
8. Pin `monaco-editor` exactly; consider dependabot/renovate disabled for it to avoid layout surprises.

---

## 14. Testing Matrix

Legend: ✔ must pass · cells: **WD** Windows dev, **WP** Windows packaged, **UD** Ubuntu dev, **UP** Ubuntu packaged. Run every row on all four; packaged rows additionally on a **clean** machine/VM and with launch-from-shortcut.

| # | Area | Test | WD | WP | UD | UP |
|---|---|---|---|---|---|---|
| 1 | Startup | App opens with **no** `D:\JAVA`; Welcome shown; no console errors; diagnostics report copies | ✔ | ✔ | ✔ | ✔ |
| 2 | Startup | `lastFolder` deleted → toast, no empty silent explorer | ✔ | ✔ | ✔ | ✔ |
| 3 | Editor | Open `.c`, type 5 000 chars continuously; no overlap; CPU sane | ✔ | ✔ | ✔ | ✔ |
| 4 | Editor | Open 10 files, switch tabs 100×; layout & caret correct each time | ✔ | ✔ | ✔ | ✔ |
| 5 | Editor | Resize window, sidebar, panel; split on/off; maximise panel | ✔ | ✔ | ✔ | ✔ |
| 6 | Editor | Terminal open/close/switch to Preview and back; editor layout + caret OK | ✔ | ✔ | ✔ | ✔ |
| 7 | Editor | Font: renders with bundled font on a machine without Consolas/JetBrains; DPI 100/125/150/200 % | ✔ | ✔ | ✔ | ✔ |
| 8 | Editor | **Ctrl+S in file B after opening A then B → only B written, with B's text** | ✔ | ✔ | ✔ | ✔ |
| 9 | Cursor | Full cursor acceptance (§6.3) editor + terminal | ✔ | ✔ | ✔ | ✔ |
| 10 | Highlight | The 7 test files (§9.2), after switch/save/rename/restart | ✔ | ✔ | ✔ | ✔ |
| 11 | Lab-safe | `.js/.css/.html/.json/.c/.py/.java`: Ctrl+Space, hover, `.`-trigger → nothing | ✔ | ✔ | ✔ | ✔ |
| 12 | FS | Create/rename/delete file & folder at root, `src`, `src/utils` | ✔ | ✔ | ✔ | ✔ |
| 13 | FS | Rename dirty open file → text preserved, tab updated, highlighting preserved | ✔ | ✔ | ✔ | ✔ |
| 14 | FS | Rename/delete folder containing open files → tabs rebased/closed | ✔ | ✔ | ✔ | ✔ |
| 15 | FS | Errors: duplicate name, invalid name, read-only dir, deleted-externally file → toast text correct | ✔ | ✔ | ✔ | ✔ |
| 16 | FS | New File / Delete UI works (no native `prompt/confirm`) | ✔ | ✔ | ✔ | ✔ |
| 17 | Run | §8.7 matrix for C, C++, Python, Java | ✔ | ✔ | ✔ | ✔ |
| 18 | Run | Press F5 with panel closed, 20× in a row: output always in the visible terminal; exactly one new PTY/run; no duplicate lines | ✔ | ✔ | ✔ | ✔ |
| 19 | Run | Press F5 immediately after app start (shell not ready) | ✔ | ✔ | ✔ | ✔ |
| 20 | Run | Infinite loop → stops at timeout; Stop button; `pgrep`/Task Manager shows no leftovers | ✔ | ✔ | ✔ | ✔ |
| 21 | Run | Compile error → markers + terminal text, **old binary not executed** (Windows!) | ✔ | ✔ | ✔ | ✔ |
| 22 | Run | Tool absent → exact message; tool installed but PATH stripped → found or precise message | — | ✔ | — | ✔ |
| 23 | Terminal | Typing, Enter, Ctrl+C, arrow history, `top`/interactive prompt, resize, long output (`yes | head -100000`), output while panel hidden then shown | ✔ | ✔ | ✔ | ✔ |
| 24 | Diagnostics | Marker positions correct for gcc/g++/javac/python samples incl. Windows drive-letter paths | ✔ | ✔ | ✔ | ✔ |
| 25 | Package | Installer on **clean** Windows 10/11 (with and without WebView2, with and without internet) | — | ✔ | — | — |
| 26 | Package | `.deb` and AppImage on clean Ubuntu 22.04 and 24.04 | — | — | — | ✔ |
| 27 | Package | Downloaded artifact SHA-256 equals published; About shows the expected commit | ✔ | ✔ | ✔ | ✔ |
| 28 | Rendering | WebView flag matrix (§4.3 step 4) when row 3–6 fail | — | ✔ | — | ✔ |

---

## 15. Regression Tests

**Automated (add Vitest — already named in `plan.md` — and Rust tests)**

* `path.test.ts`: `join/dirname/basename/isInside/rebase` for `C:\a b\c`, `/home/u/a b`, trailing separators, mixed separators, case-insensitivity on Windows paths; `validateName` table (reserved names, trailing dot/space, separators).
* `diagnostics.test.ts`: fixture outputs from real gcc, g++, clang, javac, Python tracebacks (Linux and Windows path forms) → expected markers.
* `commands.test.ts` (store logic with a mocked `fsService`): rename file/folder rebases open tabs and keeps dirty text; delete folder closes descendants; two rapid creates don't duplicate tabs; stale `listDir` response is ignored.
* `saveFlow.test.ts`: simulated editor with two models: save always writes the active model's text to its own path (guards F6).
* Rust: (a) `PtyManager::spawn` with an existing id returns `AlreadyExists`; (b) `resolve()` skips 0-byte `WindowsApps` stubs and respects candidate order (cfg-gated); (c) `run_file` with a caller-provided id emits `Compiling` to a listener registered before the call (use a test emitter); (d) name validation rejects separators; (e) existing runner/Java-detection tests stay.
* CI guards: import-path existence check; bundle contains one monaco chunk; `tsc` passes; `cargo clippy -D warnings`; Windows + Ubuntu `cargo test`.
* Editor smoke (debug command): tokenization assertions per language (§9.3).

**Manual regression checklist (per release candidate):** rows 3–28 of §14 on packaged builds.

---

## 16. Performance Tests

Run on one Windows and one Ubuntu machine, **packaged** build, **diagnostics enabled**, fixed script.

1. **Baseline:** cold start to interactive editor (ms), idle CPU/RAM of app + WebView process.
2. **Typing soak:** a script/human types ~60 chars/s into a 2 000-line C file for 10 min; record long-task count/duration, max keystroke→paint latency, CPU, RAM at t=0/10/20/30/60 min. Pass: no long task >200 ms, RAM growth <50 MB/hour, CPU back to idle within 2 s after stopping.
3. **Tab churn:** open 20 files; switch 500× (scripted via the store); `getEditors().length` constant (1 or 2), `getModels().length` = 20, listener counters flat.
4. **Resize churn:** drag-resize panel/sidebar 200×; no layout drift; zero 0×0 `layout()` calls.
5. **Terminal flood:** `yes` (Linux) / `1..200000` PowerShell loop for 30 s: UI stays responsive (typing latency in editor <100 ms), memory bounded, events/sec logged, xterm scrollback bounded (5 000).
6. **Run churn:** run a hello program 200×; process/PTY count returns to baseline after each (`list_pty_sessions`, OS process list), no leaked scratch dirs (`/tmp/codeui-*`).
7. **Soak 60 min** mixing 2–6 each 5 min; the rendering-corruption symptom must **not** appear. If it does: take the §5.1 capture at the moment it starts (and again when it heals) and attach to the issue.
8. **Rendering A/B** (only on machines that reproduce): default vs `WEBKIT_DISABLE_COMPOSITING_MODE=1` vs `WEBKIT_DISABLE_DMABUF_RENDERER=1` / `--disable-gpu` vs minimap off vs bundled font on/off (one variable at a time).
9. **Startup cost of languages (decide trimming):** time `registerLanguages`, first tokenization per language, bundle size by chunk (`vite-bundle-visualizer` or `rollup-plugin-visualizer`), memory after load — with and without TS worker/language services.

---

## 17. Acceptance Criteria (pass/fail)

**Editor**
- [ ] 60-min soak (§16.7) on Windows and Ubuntu packaged builds: zero overlap/corruption episodes.
- [ ] After each of: resize, tab switch, terminal open/close, split toggle, Welcome↔file switch — `getLayoutInfo()` height/width equal container rect (±1 px) and text is line-by-line.
- [ ] Caret visible without clicking after open/switch/new-file/terminal-close; caret colour contrast ≥ 4.5:1 vs background.
- [ ] Colours present for keywords/strings/comments/numbers in the 7 test files on a fresh install; self-test passes; survive tab switch, save, rename.
- [ ] Active-line highlight works. Basic error markers appear for gcc/g++/javac/python samples.
- [ ] No completion/suggest/hover/signature popups for any language (Ctrl+Space, hover, trigger chars). No AI features anywhere.
- [ ] Ctrl+S saves exactly the active file's current text (test #8) — 0 occurrences of cross-file overwrite.
- [ ] `getEditors().length` constant; `getModels().length` equals open files; no growth in listeners.

**Terminal**
- [ ] Cursor visible on open, after Enter, after switching panels and back, after resize, during interactive run.
- [ ] Typing, Enter, Ctrl+C, arrow-key history work; resize propagates (`stty size`/`mode con` matches).
- [ ] Run output appears in the visible terminal every time (test #18: 20/20), exactly once, no duplicate output.
- [ ] Never more than one PTY per terminal tab (+ one per active run); closing a tab/run kills its process; no stale sessions after app exit.

**Filesystem**
- [ ] Open folder; create/rename/delete files and folders at any depth with identical behaviour.
- [ ] Explorer updates immediately; open tabs stay synchronised (rename keeps unsaved text; delete closes descendants).
- [ ] Every failure produces a visible message with the OS reason; no native `prompt/confirm/alert` anywhere.
- [ ] No hard-coded paths remain (`grep -ri "D:\\\\JAVA\|sahil"` over `src/` → 0 hits).

**Execution**
- [ ] C, C++, Python, Java run on both OSes incl. `scanf`/`input()`/`Scanner` prompts shown before input.
- [ ] Missing tool → specific message with correct per-OS install hint; tool present but not on GUI PATH → still found (or message explains PATH).
- [ ] Compile errors shown **and never execute a stale binary**; runtime errors/exit codes shown; stdin works; timeout kills the whole tree; scratch dirs removed; no orphan processes (CI orphan check + manual).
- [ ] The Rust runner is the only run implementation; `runActiveFile` contains no shell strings.

**Packaging**
- [ ] Dev and packaged builds pass the same matrix with identical results (§14).
- [ ] Windows installer works on a clean machine (with documented WebView2 handling); Ubuntu `.deb`/AppImage works on clean 22.04/24.04.
- [ ] README lists runtime/compiler dependencies per OS.
- [ ] Release page contains `SHA256SUMS.txt`; About/diagnostics show the commit that matches the tag; repository contains no committed installer binaries.

---

## 18. Implementation Order (by dependency and risk)

| Phase | Work | Why here |
|---|---|---|
| **0** | Diagnostics report + build stamp (§4.2, §13.2); toast/`formatError` infrastructure (§7.5); remove hard-coded `D:\JAVA`/`sahil` (§7.6) | Everything after this must be verifiable on packaged builds; error visibility makes later bugs diagnosable. Zero-risk. |
| **1** | Editor core: model-as-source-of-truth + Ctrl+S fix (§5.4), single language registration (§5.5/§9.1-2), keep Monaco mounted, cursor/focus (§6.1), bundled font + font-ready gate (§5.3), remove redundant layout calls (§5.2) | Fixes a potential data-loss bug first, then Problems 1–2 (editor half). |
| **2** | Terminal lifecycle: single-flight session owner, persistent xterm (or Rust scrollback), duplicate-id rejection, ready-based focus, xterm cursor cleanup (§6.2, §8.3 PTY bits); Rust `async` + PTY output batching (§5.6) | Prerequisite for the Run redesign; fixes R1/R2 and Problem 2 (terminal half). |
| **3** | Filesystem refactor (§7): path utils, store actions, tab sync, in-app dialogs, Rust name validation | Depends on phase 1 (model move on rename) and phase 0 (toasts). |
| **4** | Tool resolution + PATH augmentation (§8.5) → Rust runner as the only Run path with caller-supplied `run_id`, PTY direct execution, timeout/stop (§8.2–8.4); delete shell templates; data-table runners for non-core languages | Largest change; relies on phases 0–2. If it slips, ship the §8.6 hot-fixes. |
| **5** | Diagnostics → markers (§10.1–10.3) | Needs phase 4's captured compile output. |
| **6** | Lab-safe lockdown of built-in language services; optional worker/bundle trimming (§10.5, §5.5) | After measurements (§16.9). |
| **7** | Packaging/release hygiene, CI additions, README/dependency docs, WebView2 decision (§13) | Can start in parallel with phase 1 (independent), must finish before the next public release. |
| **8** | Full §14 matrix + §16 soak on packaged builds, Windows + Ubuntu; publish only on pass | Gate. |

Cross-cutting rule: **no `setTimeout` for synchronisation**; use events/promises (font load, `fit` after size>0, terminal ready, first PTY data, model-attached).

---

## 19. Files Expected to Change

*(Likely, not exact. Don't treat this list as a spec.)*

**Frontend**
- `src/main.tsx` — single language registration, font gate, theme cursor colours, MonacoEnvironment ordering, (maybe) trimmed workers/imports.
- `src/components/editor/MonacoEditorGroup.tsx`, `SplitEditorContainer.tsx`, `monacoSafeDefaults.ts` — model ownership, ref-based handlers, no remount, focus, options.
- `src/services/editorService.ts` — `getText(path)`, `focusActive()`, model move/dispose, URI via `monaco.Uri.file`.
- `src/store/useWorkspaceStore.ts` — remove hard-coded paths, remove shell templates, FS actions, single-flight PTY, tab sync, dialogs state, focus target.
- `src/components/explorer/FileTree.tsx` (+ `Sidebar.tsx`) — consume store tree/actions, inline create/rename, delete modal.
- `src/components/terminal/TerminalPanel.tsx`, `src/services/ptyService.ts` — persistent terminal, ready-based focus, run tab, `attach/scrollback`.
- `src/services/processService.ts` — becomes the live Run API (accept `runId`, subscribe-before-invoke).
- `src/App.tsx` — remove `prompt/confirm/alert`, wire toasts, keep editor mounted.
- `src/languages/registerAllLanguages.ts`, `salivoMonaco.ts` — registration result/reporting, language-id table.
- `src/index.css` — remove dead xterm cursor CSS, `touch-action`, add `@font-face`, `--font-mono`.
- New: `src/utils/path.ts`, `src/services/notify.ts` (+ `Toasts` component), `src/services/diagnostics.ts`, `src/assets/fonts/*`, Vitest config + tests.
- `vite.config.ts` — build target, (optional) bundle visualiser.
- `package.json` — pin `monaco-editor`, add `vitest`.

**Rust / Tauri**
- `src-tauri/src/commands/fs.rs` — name validation, `async`, optional retry on save.
- `src-tauri/src/commands/terminal.rs`, `pty/mod.rs` — duplicate id, batching, scrollback/attach, `async`, cwd error, direct program spawn.
- `src-tauri/src/commands/process.rs`, `runners/*`, `proc/*` — caller `run_id`, PTY execution, tool resolver, data-table runners, Windows tree-kill, `LC_ALL=C` compile.
- `src-tauri/src/commands/env_detect.rs` — shared resolver, per-OS hints, refresh.
- New: `proc/toolpath.rs`, `commands/diagnostics.rs`; `lib.rs` registration; `build.rs` (git sha/time).
- `src-tauri/tauri.conf.json` — WebView2 install mode (decision), deb deps check; (diagnostic profile with `devtools` feature in `Cargo.toml`).

**Build / release / docs**
- `.github/workflows/ci.yml` (Windows job, deb build, guards), `release.yml` (draft, checksums, names).
- Remove `installer/*`, `installers/*` binaries; update `README.md`, add `docs/TROUBLESHOOTING.md` (WebKitGTK flags, FUSE, PATH).

---

## 20. Open Questions (cannot be answered from the repository)

1. **Which environment is "S's computer" exactly?** (OS/version, WebView2/WebKitGTK version, fonts, installed compilers, how it is launched). §4.2 report from that machine and from a failing one answers most of Problem 1/4/5.
2. **Does the overlap bug occur in the dev build on the failing machine, or only packaged?** Determines build/package vs environment.
3. **Do the target labs have internet and WebView2 pre-installed?** Decides `embedBootstrapper` vs offline installer vs documentation.
4. **Which Ubuntu versions run in the labs?** 20.04 is unsupported by a webkit2gtk-4.1 build; 24.04 needs `libfuse2t64` for AppImage.
5. **Which of the two committed Windows installers did testers actually use?** (hash the one on the failing machine; compare to both and to the GitHub release asset.)
6. **Does `window.prompt/confirm` work in the packaged app on each OS?** (Test #16 before/after; if they work everywhere, F11 downgrades but replacing them is still recommended.)
7. **What exactly is the first visible symptom of the overlap?** (Overlapping glyphs within a line vs. lines collapsed vertically vs. whole editor blank) — determines §5.1 branch; screenshots + the capture are the required evidence.
8. **Is the TS/JS/HTML/CSS/JSON language-service behaviour (hover/completion) acceptable for the "lab-safe" policy, or must it be fully removed?** (Policy decision; plan assumes fully removed.)
9. **Should line endings be preserved or normalised to LF?** Needs a product decision (F17).
10. **Does Monaco 0.56.0 resolve `esm/vs/languages/definitions/*` as well as the built-in lazy tokenizers in this lockfile?** Quick `ls`/bundle check (§4.4), then the registration simplification (§9) can be finalised.
11. **Is Tauri sync-command-on-main-thread behaviour confirmed for the exact pinned Tauri 2.x?** (Check release docs; the fix — `async` — is harmless either way.)
12. **Is a Run tab separate from the shell tab acceptable UX, or must Run output appear in the user's shell?** Plan assumes separate (safer); if the team insists on the shell, implement it only via a Rust-driven, shell-aware, quoted argv with readiness handshake — not string templates in React.
