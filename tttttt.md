# CodeUI — Stabilization, Correction & Completion Brief

**Audience:** the AI that will implement the work.
**Written by:** project planner / system designer, for the owner (Ritesh).
**Date:** 3 October 2026
**Inputs you were given:** `REPORT_1_PROBLEMS.md`, `REPORT_2_INCLUSIONS.md`, `REPORT_3_IMPROVEMENTS.md`, two screenshots of the running app. The full repository ZIP was too large to share, so you may or may not have the repo itself. If you do not have it, ask the owner for the specific files you need before changing anything.

---

## 0. READ THIS FIRST

### 0.1 What CodeUI is

CodeUI is a **desktop application** (not a website, not a web app, not a SaaS). It is a lab-safe, VS Code-style code editor for college computer labs, where VS Code is banned because its suggestions enable cheating and students otherwise fall back to Notepad.

- Stack: **Tauri 2 + Rust backend, React 18 + TypeScript + Vite 6 + Monaco Editor frontend.** React/Vite exist only as the UI layer inside the desktop webview.
- Languages it runs: C, C++, Java, Python, HTML/CSS/JS (preview), plus the in-house language Salivo.
- Targets: Windows, Ubuntu/Linux, macOS installers. The owner develops and tests on **Windows 10/11 with PowerShell**; labs are expected to be mostly Linux/Windows, often offline.
- The **website is a separate, later project** used only to distribute/install CodeUI. Do not touch or create website work in this task.

### 0.2 Product tenets (never violate, never trade away)

1. **Zero AI, zero suggestions — permanently, not a toggle.** No autocomplete, IntelliSense, snippets, parameter hints, hover docs, inline suggestions, Copilot-style anything, LSP, or AI features.
2. **Supervised execution.** Student code runs under a Rust watchdog with a configurable timeout, in a process group/tree that is fully killed on stop, timeout, or app close. No orphan processes on shared machines.
3. **Clean scratch builds.** Compiler artifacts (binaries, `.class`, objects) go to a scratch directory, never into the student's project folder.
4. **All-in-one.** Editor, explorer, search, integrated terminal, one-click Run in a single window.

### 0.3 Scope fence (do NOT build in this task)

Accounts/login, admin panel, teacher/student dashboards, grading/analytics, "Practical/Exam Mode" or lockdown mode, AI features, autocomplete, an extension host/VSIX/LSP support, website work, framework migrations (no Electron, no Tauri downgrade, no stack "modernization"). Report 3 proposes an Exam Lockdown Mode: it is **deferred** (see GREEN → later).

### 0.4 Evidence rules — claim → verify → fix

The three reports were produced by **reading code, not by running the app**, and they are not fully consistent with the screenshots (see 0.5). Therefore:

- Treat every finding in the reports as a **hypothesis until you reproduce or confirm it in the actual code**.
- Where a report and observed behavior disagree, **observed behavior wins**.
- For each item below, first write down in your report: `CONFIRMED`, `NOT PRESENT`, or `PARTIALLY TRUE (explain)`. Only then change code.
- If something is described as "working" in GREEN, do not edit it unless a RED/YELLOW item requires it, and then keep the change minimal.

### 0.5 Ground truth from the two screenshots

**Screenshot 1 — editor (`array.cpp` open, Windows, workspace `D:\Studies and All\This is C++\Basic Structure of C++ Programming #1`):**
- Line 1 renders as a pile of overlapping, unreadable glyphs drawn on top of each other. Lines 2–15 look empty except a few `}` characters at lines 9, 13, 15. The minimap shows real content, and the status bar says `Ln 12, Col 2`, so the buffer has text that is **not being drawn correctly**.
- Status bar reads `Restricted Mode` and `Java: Ready` while a **C++** file is active, with `0` errors and `0` warnings. (Report 2 describes a "Lab Safe Mode" label; the label and the Java-on-a-C++-file status need review.)
- Explorer shows `a.exe` and `a.java` beside the student's `.cpp` files. Determine whether CodeUI created `a.exe` (that would violate the scratch-build tenet) or the student did.
- The workspace path contains **spaces, `#`, and `+`** — an excellent real-world test case for quoting bugs. Keep it as a permanent test fixture.

**Screenshot 2 — terminal (`1: powershell` tab):**
- PowerShell error: `.\array.exe : The term '.\array.exe' is not recognized…`. The echoed command fragment shows a PowerShell script block containing `-Host "[Compiled in $($ms)ms]" -ForegroundColor Cyan; .\"array.exe" }`.
- Meaning: **the shipped Run button builds a PowerShell script and types it into the user's interactive shell**, then tries to launch `.\array.exe` from the project folder. That file does not exist there (compile failed, or the binary went to the scratch directory, or Windows `.exe` naming/location mismatch).
- This contradicts Report 1 §2, which says Run uses a separate piped child process (`process.rs`) and then mirrors its output into the PTY. Either two Run paths exist, the audited commit differs from the shipped build, or both. **Phase 0 must establish which code path the live Run button actually uses.**

### 0.6 Working rules

1. Work on a branch (`stabilize/<item-id>`), one logical fix per commit, message format `R3: …` / `Y2: …`.
2. Before any edit: create a safety tag/branch of the current state.
3. After each item run the full check suite (see 0.8) and paste results in your report.
4. Never claim "fixed" without a reproduction before and a passing check after.
5. **Destructive actions need explicit owner approval first:** rewriting git history, force-pushing, deleting directories that are not provably duplicates, removing features.
6. Prefer complete, working code over explanation. Keep prose in your reports short and factual.
7. Do not refactor for taste. No renames, reformatting sweeps, or dependency bumps unless an item requires it.

### 0.7 Order of work

`Phase 0 (baseline)` → `R1` → `R2` → `R3` and `R4` (parallel-capable) → `R5` → YELLOW items (Y1 first) → GREEN regression guards → GREEN "later" only with owner approval.

### 0.8 Check suite (must pass after every item once R1 is done)

```
# repo root
npm ci
npx tsc --noEmit
npm test
npm run build            # vite build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets
cargo test --workspace
# conflict-marker guard (source files only, excluding node_modules/target/dist/lockfile text blocks)
git grep -nE '^(<<<<<<<|>>>>>>>) ' -- . ':!node_modules' ':!target' ':!dist'
```

---

## PHASE 0 — BASELINE (before touching code)

Do these and report answers:

1. `git status`, current branch, last 10 commits; create tag `pre-stabilization`.
2. Where is the real project root? Reports say the working code is in `CodeUI-main/` and a partial stale copy lives at the repo root.
3. List every file containing conflict markers (`git grep`), in both trees.
4. Try the build as-is and record the first failure of `cargo check` and `npm run build`.
5. **Map the Run flow end to end:** from the Run button / `F5` → `runActiveFile` in `useWorkspaceStore.ts` → whatever it calls (`processService`, `ptyService.writePty`, a generated shell script) → what executes → where output goes → where keystrokes go. Answer explicitly: *Does Run type a script into the user's shell? Does it also spawn a piped child? Which one is live?*
6. Which Monaco options and fonts are applied, and in how many places (`registerAllLanguages.ts`, `main.tsx`, `MonacoEditorGroup.tsx`, `monacoSafeDefaults.ts`)?
7. Does `tauri.conf.json` define a CSP? Is `withGlobalTauri` on? Which capabilities/permissions are granted?
8. Is `PreviewPanel.tsx`'s iframe sandboxed, and with which flags?
9. Is `ExtensionDetailView.tsx` rendering remote Markdown/HTML (Marked.js), and is it sanitized?
10. Which of `node_modules/`, `target/`, `dist/` are tracked by git?

---

# 🔴 RED — CRITICAL: fix first, in this order

## R1 — Committed merge-conflict markers (project does not compile)

**Symptom:** Rust, TypeScript, and `npm ci` all fail. Commit `dbc0c19` merged two branches and committed unresolved markers.
**Cause:** Known (Report 1 §1). Verify each file; there may be more than the 8 listed.

**Resolve each file as follows:**

| File | Resolution |
|---|---|
| `src-tauri/src/commands/env_detect.rs` | Keep the HEAD side: `crate::proc::resolve_tool(spec.candidates).map(...)` (respects augmented PATH). Delete the `which::which` branch. |
| `src-tauri/src/pty/mod.rs` | Keep `test_duplicate_session_id_is_rejected`; ensure braces/`#[cfg(test)]` module balance. |
| `src/services/settingsService.ts` | `recentFolders: []`. Permanently delete the author's hardcoded paths (`D:\JAVA`, `C:\Users\sahil\CodeUI`) everywhere in the repo. |
| `src/services/editorService.ts` | Keep **both** sets: `getText`, `focusActive`, `layout` **and** `setMarkers`, `clearMarkers`. |
| `src/languages/registerAllLanguages.ts` | Keep registration tracking + error-reporting. Update every caller to match the final `registerAllEagerLanguages` return shape. |
| `src/components/welcome/WelcomeView.tsx` | `recentFolders \|\| []` and the "No recent folders" empty state. Fix JSX balance. |
| `src/components/editor/monacoSafeDefaults.ts` | Keep the `hover` disabled setting, but verify its type against the installed Monaco version via `tsc`. Font family: use a **single** stack `"CodeUI Mono", Consolas, "Courier New", monospace` (do not drop fallbacks — see R3). |
| `package-lock.json` | Regenerate with `npm install --package-lock-only`; confirm `npm ci` succeeds. Never hand-edit. |

**Also:** add a CI step and a local script that fail on conflict markers (see Y9).
**Done when:** the whole check suite in 0.8 passes; the marker grep returns nothing; the app launches with `npm run tauri dev`.

## R2 — Duplicated repository layout and inert CI

**Symptom:** repo root holds a partial stale copy (`src/`, `src-tauri/` with only capabilities/icons, `index.html`, `vite.config.ts`) next to the real project in `CodeUI-main/`. `.github/workflows/` lives inside `CodeUI-main/`, so GitHub never runs it. `npm`/`cargo` at the root fail.
**Do (on a branch, preserving history):**
1. Before deleting anything at root: diff root `src/` and `src-tauri/` against `CodeUI-main/` equivalents. List files that exist only in the root copy or are newer. Port any unique, valid change; otherwise discard. Report this diff to the owner.
2. Promote `CodeUI-main/*` (including dotfiles and `.github/`) to the repository root using `git mv` so history survives. Remove the stale root duplicates only after step 1.
3. Make sure `.gitignore` excludes `node_modules/`, `target/`, `dist/`, scratch/temp output, `*.exe`, `*.msi`, `*.dmg`, `*.deb`, `*.AppImage`. Untrack any of those that are currently tracked (`git rm -r --cached`) — **do not rewrite history here** (that is Y3).
4. Repair workflows at the root: `working-directory` / paths, Linux Tauri system deps (WebKitGTK 4.1, GTK3, etc.), matrix `windows-latest`, `ubuntu-22.04` (or 24.04), `macos-latest`. CI steps = the 0.8 check suite.
5. Open a PR from the branch and confirm CI actually executes and passes. The owner merges.

**Done when:** a fresh `git clone` followed by `npm ci && npm run tauri build` (and `cargo test --workspace`) works from the repo root with no extra flags, and CI is green on all three OSes.

## R3 — Editor draws corrupted/overlapping text (Screenshot 1)

**Why critical:** an editor that cannot show the student's code is unusable.
**Known:** the buffer has content (minimap, cursor position) but glyphs render wrong.
**Suspected causes, most likely first:**
1. **Font measurement mismatch** — Monaco measures character width with one font and draws with another or before the bundled `CodeUI Mono` has loaded. The unresolved font-family conflict (`CodeUI Mono` vs `Consolas`) and Monaco options being applied three separate times (`registerAllLanguages.ts`, `main.tsx`, `MonacoEditorGroup.tsx`) make this very plausible.
2. Bundled `CodeUI-Mono.ttf` not resolving in the **packaged** build (wrong `@font-face` URL / Vite `base` / asset path) or not truly monospace (unequal advance widths).
3. Global CSS affecting `.monaco-editor` text (`letter-spacing`, `font-feature-settings`, `text-rendering`, `zoom`, `transform`).
4. Windows display scaling (125%/150%), WebView2 version, or GPU rasterization issue.
5. **File on disk is actually corrupted** (write/encoding/CRLF/BOM bug). Rule this out first.

**Do, in this order:**
1. Compare the file on disk (`Get-Content -Raw`, hex dump) with the editor buffer (`model.getValue()`). If disk content is garbled, stop and escalate to Y2 (save pipeline becomes RED).
2. Check the effective font in the webview: `document.fonts.check('14px "CodeUI Mono"')`, computed styles on `.monaco-editor`, and whether the font file request succeeds in the packaged build.
3. Apply Monaco font options in **one** place. Wait for `document.fonts.ready` (and an explicit `document.fonts.load('14px "CodeUI Mono"')`) before creating the editor, and call `monaco.editor.remeasureFonts()` after fonts load or the font setting changes.
4. Remove any CSS that alters Monaco glyph metrics.
5. Add a **runtime self-check**: measure `iiiiiiiiii` vs `WWWWWWWWWW` in the chosen editor font; if widths differ (not monospace) log a warning and fall back to the next monospace in the stack.
6. Test at font sizes 12, 14, 18, 24 and Windows scaling 100/125/150%.

**Done when:** `array.cpp`-style files render correctly in all test conditions on Windows, Ubuntu, and macOS; cursor column matches the visible characters; the self-check exists.

## R4 — Run is broken and interactive input is impossible (Screenshot 2 + Report 1 §2, §6)

**Symptom A:** Run ends with `.\array.exe is not recognized`.
**Symptom B:** programs that read input (`scanf`, `cin`, `input()`, `Scanner`) cannot work; student output and shell input get mixed.
**Known:** (confirm each in code)
- Run composes a shell script and/or forwards process output into `ptyService.writePty`, which feeds the **shell's stdin** (shell tries to execute program output; double echo; `[Compiling…]` banners typed as commands).
- Keystrokes typed in the terminal go to the shell, never to the student's process. `writeRunStdin` / `closeRunStdin` may be dead code.
- `runners/c.rs` and `runners/cpp.rs` compile to `<scratch>/<stem>` and then execute `<scratch>/<stem>` without the platform exe suffix; on Windows gcc emits `<stem>.exe`. `runners/salivo.rs` already does it correctly with `std::env::consts::EXE_SUFFIX` — copy that pattern.
- The typed-script approach also launches `.\array.exe` from the *project folder*, while artifacts should be in scratch (tenet 3).

**Required architecture (planner's decision — deviate only with written justification):**
Run is a **two-phase supervised pipeline that never touches the user's shell**:

1. **Pre-flight:** save dirty files, stop any previous run, resolve the toolchain with `crate::proc::resolve_tool` (augmented PATH), create the scratch dir.
2. **Compile phase** (C, C++, Java, Salivo): run the compiler as a supervised child with stdout/stderr captured. Binary path = `scratch.join(stem + EXE_SUFFIX)`. Show compiler output in a dedicated **Run** terminal tab. Parse diagnostics (`diagnostics.ts`) into Monaco markers and the status-bar counts. On failure, do not execute; print a clear "Build failed" line.
3. **Execute phase:** spawn the program inside its **own dedicated PTY** (the existing `portable-pty` / `PtyManager`), separate from the interactive shell session, with `cwd` = the source file's folder (so relative file I/O behaves as students expect) and the augmented PATH. Stream output through the existing batched event path (8 KB / 30 ms, 5 MB cap). Route terminal keystrokes to this PTY **only while a run is active**; when it ends, keyboard control returns to the shell tab.
   - *Why a PTY and not pipes:* with pipes, C/C++ stdout is fully buffered, so a prompt like `printf("Enter n: ")` will not appear before `scanf` blocks. A PTY gives real TTY behavior (line buffering, colors, Ctrl+C, resize) without changing student code.
4. **Stop / Ctrl+C:** send `0x03` through the PTY, then after a short grace period kill the whole process tree using the existing `proc/kill.rs`. EOF input must work (Ctrl+D on Unix, Ctrl+Z+Enter on Windows) — document it.
5. **Watchdog semantics (must be decided and documented):** the current fixed 12 s wall-clock default kills any interactive program. Use: *terminate when no user input has been received and the run has exceeded N seconds since the last input (or since start), plus an absolute hard ceiling.* `N` stays the existing setting (5–300 s); raise the default to something workable for interactive use (suggest 30–60 s) and show the countdown/reason when a run is killed.
6. **Exit line:** print `[Process exited with code N in X ms]`. (The existing "Compiled in … ms" nicety can be kept as printed text.)
7. **Delete** the shell-script generation and every `ptyService.writePty(...)` call used to display run output or banners. Keep `kill.rs`, `toolpath.rs`, output batching, and the Java/Python/Salivo runners (see GREEN). Wire `writeRunStdin`/`closeRunStdin` (or their PTY replacement) properly — no dead code left behind.

*Why not Report 3's "Model A" (type the command into the user's shell):* it is effectively what already fails in Screenshot 2; it bypasses the watchdog and process-group kill; it depends on shell-specific quoting (PowerShell vs cmd vs bash) and breaks on paths with spaces, `#`, `+`, `$`, `'`; it pollutes shell history; and it makes compiler errors un-parseable for Monaco squiggles.

**Acceptance tests (automate where possible; run on Windows + Ubuntu minimum):**
- Hello World in C, C++, Java, Python runs and prints.
- C `printf("Enter n: "); scanf("%d",&n);` — prompt visible *before* typing; typed number is received; result prints.
- C++ `cin`, Python `input()`, Java `Scanner` all work interactively; EOF handling works.
- Compile error: no run attempted, squiggles + status counts + readable message.
- Infinite loop is killed by the watchdog; **no orphan process** remains (check Task Manager / `ps`). Same on Stop, on window close, and when the user starts a second run.
- 5 MB+ output loop does not freeze the UI.
- Workspace path containing spaces, `#`, `+`, parentheses, and non-ASCII characters works.
- No artifacts (`a.exe`, `.class`, objects) appear in the project folder.
- The interactive shell tab is untouched and still works during/after runs.

## R5 — Webview trust boundary (security)

**Why critical:** CodeUI exposes powerful native commands (read/write/delete files, spawn processes, PTY) to the webview. Any script that runs in that webview can use them. In a lab this means a student — or content from the internet — could read or delete files outside their folder or tamper with the environment. **Verify each point; fix what is confirmed.**

1. **Remote Markdown/HTML in the webview.** `ExtensionDetailView.tsx` renders third-party README content with Marked.js. Marked does not sanitize. Either remove this rendering (preferred, see Y4) or sanitize with DOMPurify, strip scripts/handlers, and open links via the OS browser through an allow-listed call — never navigate the app webview.
2. **Preview iframe.** Student HTML/JS runs in `PreviewPanel.tsx`. A `srcdoc`/same-origin iframe can reach `window.parent` and call Tauri IPC. Required: `sandbox="allow-scripts"` **without** `allow-same-origin`, opaque origin, and a test proving `parent.__TAURI_INTERNALS__` / `window.top` access throws from inside the preview.
3. **Tauri config.** A real CSP (not `null`), `withGlobalTauri: false`, minimum capabilities (no broad shell/fs plugin scopes), and no `dangerous*` flags. Remove external `connect-src` once the extension marketplace is gone.
4. **DevTools and context menu in release builds.** F12 / right-click → Inspect gives full IPC access from the console. Release builds must not expose DevTools or the default webview context menu. (This is a basic security measure, not Exam Mode.)
5. **Destructive backend commands.** `delete_file` (recursive), `rename_file`, `write_file` accept arbitrary paths. At minimum refuse empty paths, drive roots, the user's home directory, and system directories, and refuse deleting the open workspace root itself. Report whether confining mutations to the open workspace is feasible without breaking "open a single file" flows; implement only if it is.

**Done when:** each point has a CONFIRMED/NOT PRESENT note, confirmed ones are fixed, and an automated or documented manual test exists for items 2 and 4.

---

# 🟡 YELLOW — WARNING: fix before they become critical

Order matters: do **Y1 immediately after R1–R5**, then the rest as listed.

## Y1 — Prove the "zero suggestions" tenet (promote to RED if anything leaks)

The listed Monaco options (`quickSuggestions:false`, `suggestOnTriggerCharacters:false`, `snippetSuggestions:"none"`, `wordBasedSuggestions:"off"`, `tabCompletion:"off"`, `parameterHints`, `hover`) only stop *automatic* popups. Verify and, if needed, block **manual** and built-in paths for every language, especially HTML/CSS/JSON/JS where Monaco ships language workers with built-in completion/diagnostics:
- `Ctrl+Space`, `Ctrl+Shift+Space`, `Alt+Enter`, `F12`/go-to-definition, `Ctrl+Click`, `F2` rename, hover, inline hints, code lens, lightbulb, format-on-type, auto-closing/linked editing (decide which are acceptable), `inlineSuggest.enabled`.
- Disable or neutralize built-in language-service providers; keep Monarch syntax highlighting.
- Add a test (unit or Playwright against the Monaco instance) that asserts every blocked action produces no suggestion widget.
**Done when:** a written matrix (language × feature) shows no suggestions appear, and a regression test exists.

## Y2 — Windows save reliability (escalate to RED if R3 shows file corruption)

`write_file` uses temp-file + `std::fs::rename`. Report 1 says this fails on Windows when antivirus/indexers hold the target; Report 3 suggests a copy fallback. **Verify the claim first** (modern Rust's Windows `rename` already replaces existing files; real failures are usually `AccessDenied` from locks). Then:
- Retry the rename with short backoff (e.g., 5 tries over ~500 ms).
- If it still fails, fall back to a direct overwrite and keep the tmp copy until the write is confirmed; never leave the student with a half-written file and never delete the temp file before success.
- **Never show "saved" when a save failed**; keep the tab dirty and show a clear error.
- Test: lock the target file in another process and save.

## Y3 — Repository hygiene and distribution integrity

- 31.5 MB of installers are tracked in `installer/` and `installers/` (duplicate, differing `x64-setup.exe` builds). Untrack them (done in R2 step 3 if not earlier). **Rewriting history to shrink the clone requires owner approval** (`git filter-repo`, force-push) — ask first.
- Releases: let `release.yml` build installers and attach them to **GitHub Releases** with a `SHA256SUMS` file so lab admins can verify downloads. Code-signing is a later improvement; document its absence.
- `tauri.conf.json` has `webviewInstallMode: "embedBootstrapper"`, which still needs internet at install time if WebView2 is missing. For offline labs consider `offlineInstaller` (bigger installer) or document the prerequisite clearly.
- Confirm `target/`, `node_modules/`, `dist/` are not tracked. Decide whether `fix.md` and `codeui_package/plan.md` belong in the repo root or `docs/`.

## Y4 — Extensions tab misrepresents the product

The UI imitates the VS Code marketplace (Open VSX search, ratings, "Install"), but "Install" only flips a React boolean. There is no extension host. It also contradicts the zero-AI tenet (a marketplace can list AI extensions) and requires internet.
**Do:** replace it with an honest **"Toolchains" (Compilers & Languages)** panel: for C, C++, Java, Python, Salivo, Web — show detected path and version, ready/missing status, and OS-specific install hints (e.g., `winget install MSYS2.MSYS2` / `winget install LLVM.LLVM` on Windows, `sudo apt install build-essential default-jdk python3` on Ubuntu). A "Re-check" button re-runs detection. Remove Open VSX networking, remote README rendering, and fake Install buttons. (The owner originally wanted a way to get programming toolchains; guided detection and install hints satisfy that without pretending to install.)
**Do not** add an extension host or LSP.

## Y5 — Toolchain detection and runner flexibility

- C/C++ runners hardcode `gcc`/`g++`. Probe fallbacks: `gcc`→`clang`→(`cl.exe` optional, only if the diagnostics parser and flags are handled), `g++`→`clang++`. Use the same `resolve_tool` everywhere (runners **and** env detection **and** the PTY's PATH), so detection and execution never disagree.
- Keep Python probing `python`/`py`/`python3` and the WindowsApps stub bypass.
- When a tool is missing, show an actionable message in the terminal and Toolchains panel, not a raw OS error.
- **Status bar:** show the toolchain for the *active file's language* (e.g., `C++: g++ 13.2 ready`), not a fixed `Java: Ready`. Settle the label naming (`Restricted Mode` vs `Lab Safe Mode`) with the owner and make code, docs, and UI consistent.

## Y6 — Synchronous filesystem commands

`read_file`, `write_file`, `list_dir`, `create_file`, `search_files`, `find_files` run synchronously. Make them `async` with `tokio::task::spawn_blocking` (or equivalent), ensure large directories and network shares cannot freeze the UI, and make `search_files` cancellable/bounded. Preserve existing behavior and return types so the frontend barely changes.

## Y7 — Monaco import and configuration fragility

- `registerAllLanguages.ts` imports from `../../node_modules/monaco-editor/esm/vs/.../definitions/...`. Replace deep `node_modules` paths with supported package entry points, or bundle small standalone Monarch definitions under `src/languages/grammars/`.
- Apply Monaco language/theme/option configuration once (ties into R3).
- Make sure Monaco workers and assets load **offline** inside the packaged app.

## Y8 — Remove web-app remnants (the "built as a website" mistake)

The product is desktop-only; leftovers hide real failures.
- `ptyService.ts` has a mock fallback and `settingsService.ts` falls back to `localStorage` for "browser testing". In production builds, if the Tauri runtime is absent, show a fatal "must be run as the desktop app" screen instead of silently mocking. Keep mocks only behind an explicit dev/test flag.
- Review `public/` (favicons, browser manifest) and root `index.html`: keep only what the Tauri webview needs.
- Make sure `npm run dev` documentation says to use `npm run tauri dev`.

## Y9 — Quality gates and CI

- Conflict-marker guard in CI and as a git pre-commit script.
- CI matrix on Windows/Ubuntu/macOS running the 0.8 check suite.
- End-to-end run tests (headless where possible) mirroring the R4 acceptance list for C, C++, Java, Python (and Salivo if `sf` is available in CI, else skip with a clear note).
- Keep `xtask version-sync` in CI so `Cargo.toml`, `package.json`, and `tauri.conf.json` versions never drift.

## Y10 — Cross-platform smoke test

Windows is the owner's dev machine; Ubuntu is the main lab target. After R4, run the acceptance list on Ubuntu (WebKitGTK, PTY, `killpg` escalation, AppImage/FUSE per `docs/TROUBLESHOOTING.md`) and on macOS. Record pass/fail per platform in your report.

---

# 🟢 GREEN — WORKING / LEAVE ALONE

## G1 — Keep as is (do not rewrite; touch only if a RED/YELLOW item forces a minimal change)

- **Stack and structure:** Tauri 2 + Rust + React 18 + TS + Vite 6 + Monaco.
- **`proc/kill.rs`:** escalating process termination (Unix `killpg` SIGTERM→SIGKILL, Windows `taskkill /T /F`). Reuse it in R4.
- **`proc/toolpath.rs`:** augmented PATH and the WindowsApps 0-byte stub bypass. Extend usage (Y5), do not rewrite.
- **`pty/mod.rs` + `terminal.rs`:** `portable-pty` session management and event forwarding. R4 reuses the manager.
- **Runners:** Java runner (comment/string stripping, `package` detection, public-class vs filename check, `-d scratch` / `-cp` execution); Python runner (`-u`); Salivo runner (already uses `EXE_SUFFIX` — the reference pattern). Only the C/C++ exe-suffix fix (R4) is needed.
- **Output batching (8 KB / 30 ms) and 5 MB cap** — good; reuse for the run PTY.
- **Settings persistence** (`settings.rs`, 400 ms debounce, `%APPDATA%\codeui` / `~/.config/codeui`) and the Settings modal ranges (font 12–24, timeout 5–300 s — only the default timeout value changes in R4).
- **Shutdown hook** that kills runs and PTYs on window close (verify, don't rewrite).
- **UI shell and features:** TitleBar menus, ActivityBar, Sidebar, StatusBar structure, Toasts, QuickOpen (`Ctrl+P`), Search panel, FileTree and its context menu, split editor (`Ctrl+\`), tabs with dirty indicators, Welcome view, keyboard shortcuts (`Ctrl+S`, `F5`, `Ctrl+B`, `` Ctrl+` ``, `Ctrl+,`).
- **Preview panel** concept (live HTML/CSS/JS preview with refresh-on-save) — keep; only R5 sandbox hardening applies.
- **Salivo Monarch grammar** and the other offline grammars (apart from the import-path cleanup in Y7).
- **Lab-safe Monaco defaults** — keep the intended values; Y1 only *verifies and closes gaps*.
- **`xtask`** tooling (`version-sync`, `bump`, `audit-no-python`) and `docs/TROUBLESHOOTING.md`.
- **Bundled `CodeUI-Mono.ttf`** — presumed fine until R3 proves otherwise; the loading/measurement path is what R3 inspects.

## G2 — Regression guards for GREEN (cheap insurance)

Add tests/checks that lock GREEN behavior in place: kill-tree test, Java filename/class check test, Salivo exe-name test, settings debounce test, Monaco safe-defaults snapshot test.

## G3 — Later / optional (do NOT start without owner approval, after all RED and YELLOW are done)

1. **Problems panel** — a bottom-panel tab listing compiler errors/warnings (`file:line:col`), click to jump. (`diagnostics.ts` parsing already exists.)
2. **Editor polish:** drag-to-reorder tabs, horizontal/vertical split, `Ctrl+=` / `Ctrl+-` zoom, `Ctrl+G` go-to-line.
3. **Scratch pruning:** purge scratch build dirs older than 24 h at startup.
4. **Deployment docs:** silent install (`msiexec /i … /qn /norestart ALLUSERS=1`, `apt install ./….deb`), plus a deployable default `settings.json` template for lab admins.
5. **Exam Lockdown Mode** (kiosk window, watermark with name/roll/timer, workspace confinement, `--exam` flag) — **deferred beyond v0.1** because it conflicts with the current scope decision. Do not implement.
6. **Code signing** for installers and notarization on macOS.
7. **Official website** — separate project, only after the desktop app is stable.

---

# DEFINITION OF DONE (v0.1 stabilization)

- [ ] R1–R5 closed with evidence; Y1–Y10 closed or explicitly deferred by the owner.
- [ ] Fresh clone builds from the repo root on Windows and Ubuntu; CI is green on all three OSes.
- [ ] `array.cpp`-style files display correctly; Run works for C, C++, Java, Python including interactive input; no orphan processes; project folders stay clean.
- [ ] No suggestion/completion/hover/AI paths reachable (Y1 matrix).
- [ ] Webview trust-boundary checks (R5) pass; DevTools unreachable in release builds.
- [ ] No conflict markers, no hardcoded author paths, no tracked build artifacts.

# REPORT FORMAT (send after each item)

```
ITEM: R4
STATUS: CONFIRMED / NOT PRESENT / PARTIAL — fixed | not fixed | needs owner decision
WHAT I FOUND: (2–4 lines, with file:line)
WHAT I CHANGED: (files, short)
HOW I TESTED: (commands + results; screenshots for UI items)
RISKS / FOLLOW-UPS: (anything uncertain)
NEEDS OWNER APPROVAL: (yes/no + what)
```

# DECISIONS RESERVED FOR THE OWNER

1. Flattening the repo layout (R2) — merge the PR yourself after reviewing the diff report.
2. Rewriting git history to purge binaries (Y3).
3. Replacing the Extensions tab with the Toolchains panel (Y4).
4. Final status-bar label (`Restricted Mode` vs `Lab Safe Mode`) and default run timeout (R4/Y5).
5. Everything in G3.
