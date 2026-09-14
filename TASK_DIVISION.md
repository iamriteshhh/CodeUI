# CodeUI — 2-Person Team Task Division & Ownership Guide

> **Document Purpose:** This document breaks down the complete implementation of **CodeUI v0.1** (as defined in [`plan.md`](file:///d:/CodeUI/codeui_package/plan.md) and [`prompt.md`](file:///d:/CodeUI/codeui_package/prompt.md)) into an equitable, dependency-aware task division for a **2-person engineering team**.
>
> Upload this file to your GitHub repository root (`TASK_DIVISION.md`) or link it from `README.md` so both contributors have unambiguous clarity on who builds what, how interfaces connect, and how pull requests are reviewed.

---

## 1. Team Structure & Core Responsibilities

CodeUI is a hybrid desktop application: a **Rust backend** (managing low-level OS primitives, PTYs, child processes, signal handling, and filesystem operations) connected via Tauri IPC to a **React + TypeScript frontend** (handling Monaco editor orchestration, panel layout, tree navigation, xterm.js terminal emulation, and user settings).

To maximize development velocity without creating communication bottlenecks or merge conflicts, the workload is divided into two primary roles with clear domain boundaries:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CODEUI ARCHITECTURE                              │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  PERSON 1: Systems & Backend Lead    │  PERSON 2: UI, Editor & QA Lead      │
│  (Core Systems, Process & Packaging) │  (Frontend Architecture & Testing)   │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ • Tauri 2.x & Rust Backend Core      │ • React 18 + TypeScript UI Shell     │
│ • PTY Management (portable-pty)      │ • Monaco Editor & Safe Configuration │
│ • Process Execution Engine & Watchdog│ • File Tree Explorer Component       │
│ • Runner Trait & Native Runners      │ • Terminal Frontend (xterm.js + fit) │
│ • Linux Packaging (AppImage / .deb)  │ • Scripting/Web Runners & Previews   │
│ • Rust Unit & Integration Tests      │ • Vitest Unit Tests & QA Test Matrix │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### Role Summary

| Attribute | **Person 1 (Dev A) — Systems & Backend Lead** | **Person 2 (Dev B) — Frontend, UI & QA Lead** |
|---|---|---|
| **Primary Domain** | Rust core (`src-tauri/`), systems programming, OS processes, packaging | React/TypeScript (`src/`), UI/UX, editor integration, test automation |
| **Secondary Domain** | IPC command contracts, CI infrastructure, `xtask` build tools | Service client wrappers (`src/services/`), component state, QA test matrix |
| **Primary Languages** | **Rust**, POSIX Shell (packaging hooks only) | **TypeScript**, HTML, CSS |
| **Core Accountability** | Safe process execution, zero orphaned processes, PTY stability, packaging | Zero autocomplete leakage, clean responsive UI, test suite passing, DoD compliance |

---

## 2. Hard Project Constraints (Both Developers Must Obey)

Before touching any code, both developers must review and enforce these four non-negotiable rules:

1. **NO PYTHON ANYWHERE IN THE REPOSITORY TOOLING:**
   - Python must **never** be used for scripts, icons, build automation, testing, or CI.
   - For backend/build scripts $\rightarrow$ use the **Rust `xtask` crate** (`cargo run -p xtask -- <task>`).
   - For frontend scripts $\rightarrow$ use **Node.js/TypeScript** (`tsx`).
   - Python appears in this project **exclusively** as a runtime execution target invoked via `python3` for students' code.
   - Every PR must verify: `git diff --name-only <base>...<head> | grep -E '\.py$'` returns empty.

2. **NO AUTOCOMPLETE, SUGGESTIONS, OR AI IN THE EDITOR — EVER:**
   - Monaco's suggestions must be stripped at initialization (`quickSuggestions: false`, `suggestOnTriggerCharacters: false`, `wordBasedSuggestions: "off"`, `parameterHints: { enabled: false }`, `inlineSuggest: { enabled: false }`).
   - Person 2 implements an automated regression test in Phase 2 that fails CI if any suggestion popup appears in the DOM.

3. **STRICT 1:1 IPC WRAPPER DISCIPLINE:**
   - The frontend never touches the OS directly. Every OS operation goes through a typed wrapper in `src/services/*Service.ts` calling a single narrow `#[tauri::command]` in `src-tauri/src/commands/*.rs`.
   - Never create a generic "execute shell string" command.

4. **SAFE PROCESS LIFECYCLE & PROCESS GROUPS:**
   - Every spawned compiler, student binary, or terminal shell must be spawned in its own process group (`setsid`/`setpgid`) and killed cleanly on timeout or window close to prevent orphaned processes on lab PCs.

---

## 3. Codebase File Ownership Matrix

To prevent merge conflicts, each developer has primary ownership over specific directories and files:

```
codeui/
├── src/                                   # >>> PRIMARY: PERSON 2 (FRONTEND LEAD) <<<
│   ├── components/
│   │   ├── shell/                         # Layout, resizable panels, menu bar [Person 2]
│   │   ├── editor/                        # Monaco wrapper, tabs, find/replace [Person 2]
│   │   ├── explorer/                      # Directory tree, context menu [Person 2]
│   │   ├── terminal/                      # xterm.js container & event hooks [Person 2 & Person 1]
│   │   └── settings/                      # Settings modal & theme picker [Person 2]
│   ├── services/                          # Typed Tauri IPC wrappers
│   │   ├── fsService.ts                   # [Person 2, paired with Person 1's fs.rs]
│   │   ├── processService.ts              # [Person 1, paired with process.rs]
│   │   ├── ptyService.ts                  # [Person 1, paired with terminal.rs]
│   │   ├── envService.ts                  # [Person 2, paired with env_detect.rs]
│   │   └── settingsService.ts             # [Person 2, paired with settings.rs]
│   ├── hooks/                             # React hooks (useFile, useTerminal) [Person 2]
│   ├── types/                             # Shared TypeScript interfaces [Jointly Maintained]
│   └── App.tsx                            # Root application entry [Person 2]
│
├── src-tauri/                             # >>> PRIMARY: PERSON 1 (BACKEND LEAD) <<<
│   ├── src/
│   │   ├── commands/                      # Rust #[tauri::command] handlers
│   │   │   ├── fs.rs                      # Filesystem CRUD & error typing [Person 1]
│   │   │   ├── process.rs                 # Execution engine & kill signals [Person 1]
│   │   │   ├── terminal.rs                # PTY IPC handlers & resize IOCTL [Person 1]
│   │   │   ├── env_detect.rs              # Toolchain PATH detector [Person 1]
│   │   │   └── settings.rs                # JSON persistence handler [Person 1]
│   │   ├── runners/                       # Language Execution Modules
│   │   │   ├── runner_trait.rs            # Shared LanguageRunner trait [Person 1]
│   │   │   ├── c.rs & cpp.rs              # GCC/G++ compile+run pipelines [Person 1]
│   │   │   ├── java.rs                    # Java compile+run + class parsing [Person 1]
│   │   │   └── python.rs                  # Python3 unbuffered runner [Person 2]
│   │   ├── pty/                           # portable-pty lifecycle manager [Person 1]
│   │   └── main.rs                        # Tauri initialization & command registry [Person 1]
│   ├── Cargo.toml                         # Rust dependencies [Person 1]
│   └── tauri.conf.json                    # Tauri window & bundle config [Joint]
│
├── xtask/                                 # Rust build automation (NO Python!) [Person 1]
│   └── src/main.rs
├── tests/
│   ├── frontend/                          # Vitest unit tests [Person 2]
│   └── integration/                       # Real Ubuntu round-trip tests [Person 1 & Person 2]
├── docs/                                  # Documentation & images [Joint]
├── .github/workflows/                     # GitHub Actions CI pipeline [Person 1]
└── package.json                           # Frontend dependencies [Person 2]
```

---

## 4. Phase-by-Phase Task Breakdown (Phases 0 to 12)

This section maps directly to `plan.md` Section 10 and Section 10.1. Each phase details:
- **Person 1 Tasks**
- **Person 2 Tasks**
- **Handoff / Integration Point**
- **Verification Gate**

---

### Phase 0: Project Foundation & Environment Setup
*Objective:* Scaffold Tauri 2.x + React + TypeScript and ensure a blank window launches on Ubuntu.

- **Person 1 (Backend & Infra):**
  - Initialize Tauri project skeleton (`src-tauri/`) with Tauri 2.x and Rust stable.
  - Set up `xtask/` binary crate (`cargo new xtask --bin`) for future automation scripts.
  - Create GitHub Actions CI workflow (`.github/workflows/ci.yml`) running `cargo clippy`, `cargo test`, and `npm run build` on every PR.
  - Verify that `cargo tauri dev` boots without WebKitGTK errors on the target Ubuntu environment.
- **Person 2 (Frontend & Tooling):**
  - Scaffold React 18 + TypeScript + Vite frontend inside `src/`.
  - Configure `tsconfig.json` with strict mode (`"strict": true`).
  - Set up `vitest` and `@testing-library/react` for frontend unit tests.
  - Verify base styling reset and ensure Vite HMR connects cleanly to Tauri's webview.
- **Handoff / Gate:** Both developers clone the repo and successfully launch a blank window on Ubuntu via `npm run tauri dev` with clean CI status.

---

### Phase 1: Application Shell & Window Layout
*Objective:* Build the 3-panel resizable IDE layout and wire global keyboard shortcuts.

- **Person 1 (Backend):**
  - Configure window parameters in `tauri.conf.json` (title, minimum dimensions: 1024x700, window icon, menu decorations).
  - Implement basic window lifecycle hooks in Rust (handling close requests, stubbing unsaved changes confirmation).
- **Person 2 (Frontend):**
  - Implement the 3-panel resizable layout in `src/components/shell/` (File Explorer on left, Code Editor in center, Terminal at bottom).
  - Implement panel collapse/expand toggles and drag-handle resizing with min/max size constraints.
  - Create top menu bar component and wire global keyboard shortcuts (`Ctrl+S` save, `Ctrl+F` find, `Ctrl+\`` toggle terminal).
- **Handoff / Gate:** Clean, responsive 3-panel desktop layout running in Tauri. Panels resize smoothly without layout flickering.

---

### Phase 2: Editor Integration & Anti-Autocomplete Lockdown
*Objective:* Integrate Monaco editor with tabs, find/replace, and **strictly disabled** autocomplete.

- **Person 1 (Backend Support):**
  - Review editor IPC contracts in `src/types/editor.ts`.
  - Assist with setting up dirty-buffer memory management benchmarks for large files.
- **Person 2 (Frontend Lead):**
  - Install and configure `@monaco-editor/react`.
  - **Critical Security Step:** Create `src/components/editor/monacoSafeDefaults.ts` with all suggestions, parameter hints, word completions, and inline suggestions permanently turned off:
    ```ts
    export const MONACO_LAB_SAFE_OPTIONS = {
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      parameterHints: { enabled: false },
      wordBasedSuggestions: "off",
      inlineSuggest: { enabled: false },
      lightbulb: { enabled: "off" },
      suggest: { showWords: false, showSnippets: false }
    };
    ```
  - Implement Tab Manager: multiple open tabs, active tab switching, close tab button, and dirty (unsaved) indicators based on buffer-vs-disk comparison.
  - Configure syntax highlighting for C, C++, Python, Java, HTML, CSS, JavaScript.
  - **Mandatory Automated Test:** Write a Vitest component test asserting that typing trigger characters (such as `.` or `->`) produces zero suggestion widgets in the DOM.
- **Handoff / Gate:** User can open multiple files, edit text with syntax highlighting, and verify under automated test that no suggestion popups can appear.

---

### Phase 3: File Management & Explorer
*Objective:* Real directory tree browsing and filesystem operations with safe error handling.

- **Person 1 (Rust Backend):**
  - Implement Rust `#[tauri::command]` functions in `src-tauri/src/commands/fs.rs`:
    - `read_file(path: String) -> Result<String, FsError>`
    - `write_file(path: String, contents: String) -> Result<(), FsError>`
    - `list_dir(path: String) -> Result<Vec<FileEntry>, FsError>`
    - `rename_file(old_path: String, new_path: String) -> Result<(), FsError>`
    - `delete_file(path: String) -> Result<(), FsError>`
  - Implement strong typed error handling (`FsError::NotFound`, `FsError::PermissionDenied`, `FsError::IoError`).
  - Write Rust unit tests in `src-tauri/src/commands/fs.rs` covering read-only directories and non-existent paths.
- **Person 2 (React Frontend):**
  - Create `src/services/fsService.ts` mapping 1:1 to Rust filesystem commands.
  - Build `src/components/explorer/FileTree.tsx`: recursive directory tree, expand/collapse folders, active file highlight.
  - Add file/folder creation inline inputs, rename modal, and delete confirmation dialog (with warning about permanent deletion).
  - Connect file clicks to opening new editor tabs or focusing existing tabs.
- **Handoff / Gate:** Student can open an Ubuntu project folder, browse nested folders, create, rename, edit, save, and delete files with clear permission error dialogs.

---

### Phase 4: Integrated Terminal (PTY & xterm.js)
*Objective:* Embedded pseudo-terminal supporting interactive shells, `Ctrl+C`, and resize handling.

- **Person 1 (Rust PTY Systems):**
  - Integrate `portable-pty` crate in `src-tauri/src/pty/`.
  - Spawn user's default `$SHELL` (falling back to `bash` if unset) attached to a real pseudo-terminal.
  - Implement commands in `src-tauri/src/commands/terminal.rs`:
    - `spawn_pty()`, `write_pty(session_id, data)`, `resize_pty(session_id, cols, rows)`, `kill_pty(session_id)`.
  - Stream PTY stdout/stderr back to the frontend via Tauri event `pty-data-{session_id}`.
  - Handle resize via ioctl `TIOCSWINSZ` to prevent garbled output in full-screen programs (`vim`, `top`).
  - Ensure killing a terminal panel destroys its underlying process group to prevent orphaned shell sessions.
- **Person 2 (Frontend Terminal UI):**
  - Integrate `xterm` and `xterm-addon-fit` in `src/components/terminal/TerminalPanel.tsx`.
  - Create `src/services/ptyService.ts` to manage session lifecycle.
  - Forward keystrokes and pasted text from xterm.js directly to `write_pty`.
  - Listen to `pty-data` events and feed them into `xterm.write()`.
  - Hook container resize events to `FitAddon` and invoke `resize_pty(cols, rows)`.
- **Handoff / Gate:** Terminal opens inside CodeUI, runs standard Linux commands (`ls`, `top`, `vim`), handles `Ctrl+C` cleanly, and resizes without visual distortion.

---

### Phase 5: C & C++ Execution Engine
*Objective:* One-click compile and run for C/C++ with streamed output, timeouts, and crash hints.

- **Person 1 (Execution Engine & Runners):**
  - Implement `LanguageRunner` trait in `src-tauri/src/runners/runner_trait.rs`.
  - Implement `c.rs` (`gcc -Wall -g -o <bin> <source.c>`) and `cpp.rs` (`g++ -Wall -g -std=c++17 -o <bin> <source.cpp>`).
  - Implement `src-tauri/src/commands/process.rs`:
    - Process-group isolation (`setsid` / `setpgid`).
    - Real-time stdout/stderr streaming via Tauri events.
    - 12-second configurable execution timeout with escalating termination (`SIGTERM` $\rightarrow$ 500ms $\rightarrow$ `SIGKILL`).
    - Manual "Stop" command triggering the same kill path.
  - Implement exit-code lookup table (`139` = Segfault, `134` = Abort, `136` = FPE, `137` = Killed/Timeout).
- **Person 2 (UI Integration & Error Panels):**
  - Create `src/services/processService.ts`.
  - Add "Run" and "Stop" buttons to the editor header toolbar.
  - Build execution output panel displaying:
    - Distinct compile error view (red highlight, compiler stderr) vs runtime output.
    - Plain-language crash hint banner (e.g. *"Program crashed — likely a segmentation fault"*).
    - Execution timer and process exit status badge.
- **Handoff / Gate:** User writes a `.c` or `.cpp` program, clicks "Run", sees real-time output, compiles with syntax errors to view compiler diagnostics, and runs an infinite loop `while(1){}` to verify it is killed after 12s.

---

### Phase 6: Python Execution Runner
*Objective:* One-click execution for Python with unbuffered output streaming.

- **Person 1 (Backend Execution Integration):**
  - Assist Person 2 in integrating `python.rs` into the `LanguageRunner` registry.
  - Validate process-group termination when stopping Python scripts that spawn child processes.
- **Person 2 (Runner Implementation & Testing):**
  - Implement `src-tauri/src/runners/python.rs` implementing `LanguageRunner`.
  - **Critical Flag:** Execute using `python3 -u <file.py>` to disable stdout buffering for real-time streaming.
  - Parse uncaught tracebacks without altering student output.
  - Write test cases for: (1) simple print script, (2) infinite loop, (3) runtime exception traceback.
- **Handoff / Gate:** Running a Python script prints output line-by-line as it executes (not buffered until termination) and stops immediately when "Stop" is clicked.

---

### Phase 7: Java Execution Runner
*Objective:* One-click compile and run for Java with automatic class detection.

- **Person 1 (Java Runner Implementation):**
  - Implement `src-tauri/src/runners/java.rs`:
    - Stage compilation into an isolated temporary scratch directory: `javac -d <scratch> <Source.java>`.
    - Detect main class name from source or AST/regex (`public class ([A-Za-z0-9_]+)`).
    - Execute: `java -cp <scratch> <ClassName>`.
    - Clean up temporary `.class` files in scratch directory on exit.
  - Surface `javac` compile errors clearly separated from JVM runtime exceptions.
- **Person 2 (Frontend UX & Loading States):**
  - Handle JVM startup latency UX: display an active *"Compiling Java & starting JVM..."* status indicator so the app never feels frozen.
  - Format Java stack traces cleanly in the output console.
  - Verify filename vs class name mismatch error handling.
- **Handoff / Gate:** Java program compiles, runs, displays stdout, and cleans up compiled `.class` files without cluttering the student's project directory.

---

### Phase 8: Web Development Preview
*Objective:* In-app or external browser preview for HTML/CSS/JavaScript.

- **Person 1 (Backend / Preview Protocol):**
  - Implement local preview server or file URL generator in Rust (ensuring local asset references resolve correctly).
  - Detect system browser availability (`firefox`, `chromium`, etc.) as fallback.
- **Person 2 (Frontend Preview Pane):**
  - Implement side-by-side or tabbed Web Preview Pane for HTML files.
  - Implement a manual "Refresh Preview" action that reloads saved changes.
  - Support syntax highlighting for HTML, CSS, and JavaScript in the editor.
- **Handoff / Gate:** Student can create `index.html`, `style.css`, and `app.js`, edit them, and immediately view the rendered page in the preview pane.

---

### Phase 9: Environment Toolchain Detection
*Objective:* Detect missing compilers on startup and display actionable diagnostics.

- **Person 1 (Toolchain Detection Command):**
  - Implement `src-tauri/src/commands/env_detect.rs`:
    - Resolve system `$PATH` for: `gcc`, `g++`, `python3`, `javac`, `java`, and default shell.
    - Check presence using `which <tool>` semantics (do **not** invoke `--version` so broken installations aren't misreported as absent).
    - Return structured JSON: `{ name: string, path: string | null, available: boolean }[]`.
- **Person 2 (Diagnostics UI & Banner):**
  - Create `src/services/envService.ts`.
  - Implement non-intrusive startup notification banner and "System Health / Diagnostics" modal:
    - Green checks for installed tools.
    - Amber/red warning for missing tools with exact Ubuntu installation commands (e.g. `sudo apt install build-essential default-jdk python3`).
- **Handoff / Gate:** Launching CodeUI on a machine without `javac` clearly states *"Java compiler (javac) not found"* without crashing or hanging.

---

### Phase 10: User Settings & Visual Polish
*Objective:* Persisted user preferences (theme, font size, tab width, shell).

- **Person 1 (Backend Storage):**
  - Implement `src-tauri/src/commands/settings.rs`:
    - Read and write `~/.config/codeui/settings.json`.
    - Implement thread-safe debounced disk writing on changes.
- **Person 2 (Frontend UI & State):**
  - Build `src/components/settings/SettingsModal.tsx`.
  - Wire settings into the application state:
    - Font size (12px–24px) $\rightarrow$ updates Monaco and xterm.js live.
    - Theme (Dark / Light) $\rightarrow$ updates Monaco theme and CSS variables.
    - Tab width (2 vs 4 spaces).
    - Default shell path override.
- **Handoff / Gate:** Changing font size to 18px and theme to Dark updates the UI immediately and remains saved after completely restarting the app.

---

### Phase 11: Testing Hardening & Test Matrix Execution
*Objective:* Full pass of the Section 11/11.1 edge-case matrix on a clean Ubuntu VM.

- **Person 1 (Backend & Systems Hardening):**
  - Execute test cases:
    - **Infinite loops:** `while(1){}` terminated cleanly; zero leftover processes in `ps -ef`.
    - **Fork bomb resilience:** Child process tree killed cleanly on timeout or manual Stop.
    - **File permissions:** Read-only file returns descriptive `PermissionDenied`.
    - **Interactive stdin:** Terminal properly accepts input during `scanf` / `input()`.
- **Person 2 (Frontend & UI Hardening):**
  - Execute test cases:
    - **Suggestions Regression Check:** Automated test passes with 0 autocomplete widgets.
    - **Large files:** Multi-megabyte file open stress test without freezing UI.
    - **Multi-tab stress:** 30+ tabs open with clean tab scrolling and buffer management.
    - **Directory deleted externally:** Graceful handling if workspace folder is deleted.
    - **No-Python Repo Audit:** Run `git diff --name-only | grep '\.py$'` to confirm zero violations.
- **Handoff / Gate:** All 10 edge cases in `plan.md` Section 11.1 pass with documented evidence on an Ubuntu test environment.

---

### Phase 12: Packaging & Distribution
*Objective:* Produce a standalone AppImage and verify clean-system execution.

- **Person 1 (Packaging Lead):**
  - Configure `tauri.conf.json` bundler targets for Linux (`appimage` and `deb`).
  - Write an `xtask` script in Rust to automate version synchronization between `package.json` and `Cargo.toml`.
  - Build the production release binary: `cargo tauri build --bundles appimage`.
  - Validate the generated AppImage on a clean Ubuntu machine without dev tools installed.
- **Person 2 (Release Docs & QA Verification):**
  - Create release installation instructions in `README.md`.
  - Verify first-launch behavior on the clean test machine:
    - Environment Detection detects tools correctly.
    - Default settings file creates cleanly under `~/.config/codeui/settings.json`.
    - Sample C, C++, Python, and Java programs compile and run.
- **Handoff / Gate:** Standalone `CodeUI-v0.1.0.AppImage` executes smoothly on a pristine Ubuntu installation, fulfilling every item of the Definition of Done.

---

## 5. Daily Git & GitHub Collaboration Workflow

To maintain smooth cooperation without stepping on each other's toes:

### 5.1 Branching Model
```
main (always stable, deployable)
  ▲
  │ (Pull Request after Phase Gate passes)
dev (active integration branch)
  ▲
  ├── feature/phase-2-monaco-editor     (Person 2)
  ├── feature/phase-3-fs-commands       (Person 1)
  ├── feature/phase-4-pty-terminal      (Person 1)
  └── feature/phase-4-xterm-frontend    (Person 2)
```

- Always branch off `dev`: `git checkout -b feature/phase-<number>-<name> dev`.
- Keep feature branches short-lived (1–3 days max).
- Merge back into `dev` exclusively via Pull Requests.

### 5.2 Conventional Commits Standard
Every commit message must follow this format:
```
<type>(<scope>): <short summary in imperative mood>

Types: feat, fix, chore, test, docs, refactor
Scopes: editor, runner, pty, fs, shell, packaging, env
```
*Examples:*
- `feat(editor): disable all Monaco autocomplete and parameter hints`
- `feat(pty): implement process-group termination on panel close`
- `fix(runner): add -u flag to python execution to unbuffer stdout`
- `test(editor): add automated regression test asserting no suggestions in DOM`
- `chore(xtask): add version bumper script in rust`

### 5.3 3-Point Mandatory PR Review Checklist
Every Pull Request requires review and approval from the other developer. Before hitting **Merge**, the reviewer must explicitly check off these three items:

1. [ ] **No Python in Diff:** Run `git diff --name-only origin/dev | grep -E '\.py$'`. Result MUST be completely empty.
2. [ ] **Process Safety:** If new child processes or PTYs are spawned, do they use process-group kills (`setsid`/`setpgid`) with timeout escalation?
3. [ ] **Input Validation:** Does any new Tauri command validate file paths and reject arbitrary shell execution?

---

## 6. GitHub Milestones & Issues Setup (Ready to Copy-Paste)

You can copy and paste this list directly into GitHub Issues to track your progress:

### Milestone 1: Core Shell & Editor (Phases 0–2)
- [ ] **Issue 1.1 [Person 1]:** Scaffold Tauri 2.x backend, Rust stable, and `xtask` skeleton (`#foundation`)
- [ ] **Issue 1.2 [Person 2]:** Scaffold React 18, TypeScript strict mode, and Vitest test runner (`#foundation`)
- [ ] **Issue 1.3 [Person 1]:** Set up GitHub Actions CI for Rust clippy, tests, and npm build (`#ci`)
- [ ] **Issue 1.4 [Person 2]:** Implement 3-panel resizable layout and global keyboard shortcuts (`#shell`)
- [ ] **Issue 1.5 [Person 2]:** Integrate Monaco editor with `monacoSafeDefaults.ts` completely disabling suggestions (`#editor`)
- [ ] **Issue 1.6 [Person 2]:** Implement Tab Manager with dirty state and multiple open tabs (`#editor`)
- [ ] **Issue 1.7 [Person 2]:** Write automated Vitest check asserting no autocomplete popups appear in DOM (`#test`)

### Milestone 2: Filesystem & Terminal (Phases 3–4)
- [ ] **Issue 2.1 [Person 1]:** Implement Rust `fs.rs` commands (`read`, `write`, `list`, `rename`, `delete`) with typed errors (`#fs`)
- [ ] **Issue 2.2 [Person 2]:** Create `fsService.ts` and React `FileTree.tsx` component with delete confirmation (`#explorer`)
- [ ] **Issue 2.3 [Person 1]:** Integrate `portable-pty`, implement `spawn_pty`, resize IOCTL, and process-group kill (`#terminal`)
- [ ] **Issue 2.4 [Person 2]:** Implement `TerminalPanel.tsx` with xterm.js, FitAddon, and IPC event streaming (`#terminal`)

### Milestone 3: Execution Engine & Language Runners (Phases 5–8)
- [ ] **Issue 3.1 [Person 1]:** Implement `LanguageRunner` trait, timeout watchdog, and process-group killer (`#runner`)
- [ ] **Issue 3.2 [Person 1]:** Implement C (`gcc`) and C++ (`g++`) runners with exit code / crash hint table (`#runner`)
- [ ] **Issue 3.3 [Person 2]:** Build Run/Stop toolbar buttons and styled execution output console (`#ui`)
- [ ] **Issue 3.4 [Person 2]:** Implement Python runner (`python3 -u`) with real-time stdout streaming (`#runner`)
- [ ] **Issue 3.5 [Person 1]:** Implement Java runner (`javac` to scratchdir, class detection, `java` run) (`#runner`)
- [ ] **Issue 3.6 [Person 2]:** Implement Web Development Preview pane with manual refresh (`#web`)

### Milestone 4: System Integration, Polish & Release (Phases 9–12)
- [ ] **Issue 4.1 [Person 1]:** Implement `detect_tools` command checking system PATH for toolchains (`#env`)
- [ ] **Issue 4.2 [Person 2]:** Build Environment Diagnostics modal and missing-tool startup banner (`#ui`)
- [ ] **Issue 4.3 [Person 1]:** Implement JSON settings persistence in `~/.config/codeui/settings.json` (`#settings`)
- [ ] **Issue 4.4 [Person 2]:** Build Settings UI (font size, dark/light theme, tab width, shell) (`#settings`)
- [ ] **Issue 4.5 [Person 1 & 2]:** Execute Section 11.1 full test matrix on an Ubuntu VM (`#qa`)
- [ ] **Issue 4.6 [Person 1]:** Configure Tauri bundler and produce standalone `AppImage` release (`#packaging`)
- [ ] **Issue 4.7 [Person 2]:** Perform clean-machine install verification and write release `README.md` (`#release`)

---

## 7. Definition of Done Checklist for v0.1

Before tagging the `v0.1.0` release on GitHub, both developers must jointly sign off on these 10 acceptance criteria from `plan.md` Section 15:

- [ ] 1. **Editor:** Create, open, edit, and save files with syntax highlighting, tabs, and find/replace. **Zero autocomplete or suggestion popups ever appear** (verified by automated test).
- [ ] 2. **Explorer:** Browse, create, rename, and delete files/folders with confirmation dialogs.
- [ ] 3. **Terminal:** Embedded terminal runs interactive shell commands (`scanf`, `input()`, `Ctrl+C`) without external windows.
- [ ] 4. **Execution:** C, C++, Python, and Java compile and run with clear separation of compiler errors, runtime output, and exit-code crash hints. Runaway processes stop via timeout or manual Stop button.
- [ ] 5. **Web Preview:** HTML, CSS, and JS can be edited and previewed locally in the preview pane.
- [ ] 6. **Environment Detection:** Missing compilers (`gcc`, `g++`, `python3`, `javac`, `java`) are reported clearly on startup.
- [ ] 7. **Settings:** Font size, theme, tab width, and shell path persist across application restarts.
- [ ] 8. **Packaging:** Standalone AppImage builds successfully and runs on a clean Ubuntu installation.
- [ ] 9. **Stability:** Full Section 11.1 edge-case test matrix passes with zero unresolved crashes.
- [ ] 10. **Zero Python in Codebase:** Audited and confirmed that **no `.py` files exist in the repository** for building, scripting, testing, or CI.
