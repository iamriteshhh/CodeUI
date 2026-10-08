# CODEUI MASTER STUDY GUIDE & VIVA DEFENSE MANUAL

> **Purpose of this Document:**  
> This file is your ultimate study companion for project presentations, practical evaluations, and external examiner Viva Voce examinations. It explains **every single file** in the CodeUI repository, why it exists, how it works technically, and provides **35+ real-world examiner questions with ready-to-speak answers** so you never get quiet, confused, or blank out in front of your teachers.

---

## TABLE OF CONTENTS
1. [The 2-Minute Elevator Pitch (How to Introduce CodeUI)](#1-the-2-minute-elevator-pitch)
2. [End-to-End System Flow (What Happens When You Click "Run"?)](#2-end-to-end-system-flow)
3. [Complete File-by-File & Folder-by-Folder Guide](#3-complete-file-by-file--folder-by-folder-guide)
   - [3.1 Root Configuration & Build Files](#31-root-configuration--build-files)
   - [3.2 Rust Backend (`src-tauri/`)](#32-rust-backend-src-tauri)
   - [3.3 Frontend Core & State (`src/`)](#33-frontend-core--state-src)
   - [3.4 Frontend Services (`src/services/`)](#34-frontend-services-srcservices)
   - [3.5 UI Components (`src/components/`)](#35-ui-components-srccomponents)
   - [3.6 Languages, Utilities & Data (`src/languages/`, `src/utils/`, `src/data/`)](#36-languages-utilities--data)
   - [3.7 Automation Tooling (`xtask/`)](#37-automation-tooling-xtask)
4. [Deep-Dive Technical Concepts (The "Secret Sauce")](#4-deep-dive-technical-concepts)
5. [Teacher & Examiner Viva Voce Q&A Bank (35+ Questions & Model Answers)](#5-teacher--examiner-viva-voce-qa-bank)

---

# 1. The 2-Minute Elevator Pitch
*If your teacher or examiner asks: "Tell me about your project in 2 minutes," speak this with confidence:*

> *"Good morning/afternoon, Sir/Ma'am. Our project is **CodeUI**, a lightweight, assistance-free desktop Integrated Development Environment (IDE) built specifically for college computer laboratories and practical examinations.*
>
> *The problem we are solving is the **academic lab dilemma**: In college practical exams, students are prohibited from using modern IDEs like VS Code because features like autocomplete, code suggestions, IntelliSense, and AI assistants (like Copilot or ChatGPT) undermine exam integrity. As a result, colleges force students to use bare text editors like Notepad, gedit, or nano.*
> 
> *However, this strips away baseline developer tools: students lose syntax highlighting, have no integrated terminal (forcing constant Alt-Tabbing), have no file explorer, and get no visual compiler error markers. On top of that, student code often crashes shared lab computers with infinite loops or orphaned processes.*
>
> *CodeUI bridges this exact gap: It gives students a clean, modern programming environment with Monaco Editor, an integrated xterm.js terminal, split views, and automatic compiler error squigglies—while **strictly, permanently disabling all autocomplete, suggestions, parameter hints, and AI features**.*
>
> *Architecturally, it is built with **Tauri 2.x and Rust** on the backend for memory safety, supervised execution (process groups, timeouts, and OS sandboxing where the platform supports it), and **React 18 with TypeScript** on the frontend for high-fidelity UI. It consumes only ~60MB of RAM compared to Electron's 300MB+, making it ideal for college computers."*

---

# 2. End-to-End System Flow
*Examiners love to ask: "Trace the exact execution flow when a student writes code and clicks Run." Here is the exact path:*

```
[Student clicks 'Run' in React UI]
                 │
                 ▼
[1. Frontend Check (src/store/useWorkspaceStore.ts)]
    • Checks active file path and dirty state.
    • Saves the file to disk if modified via fsService.ts.
                 │
                 ▼
[2. Tauri IPC Invoke (`run_file`)]
    • Invokes Rust command: commands::process::run_file(source_path).
                 │
                 ▼
[3. Runner Dispatch (src-tauri/src/runners/mod.rs)]
    • Checks file extension (.c, .cpp, .java, .py, .sal).
    • Resolves appropriate LanguageRunner struct (e.g., CRunner, JavaRunner).
    • Creates a RunContext with:
         - source: Path to file
         - scratch: Private temporary build directory (/tmp/codeui-xyz or %TEMP%\codeui-xyz)
         - workdir: The student's project folder
                 │
                 ▼
[4. Build Phase (if compiled language)]
    • Emits IPC status event: { phase: "compiling", language: "c" }.
    • Executes compiler command (e.g., gcc -Wall -g -o <scratch>/program <source>).
    • If compilation fails:
         - Captures stderr.
         - Emits { phase: "compileFailed", exitCode: ... }.
         - Frontend parses stderr with parseCompilerDiagnostics() and paints
           red squiggly error markers directly on Monaco Editor lines.
                 │
                 ▼
[5. Process Group Detachment & Spawning]
    • Rust calls `detach_process_group(&mut cmd)`.
         - On Linux: calls `libc::setsid()` so the child becomes a process group leader.
         - On Windows: passes `CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`.
    • Spawns the binary/interpreter (e.g., python -u script.py) through the OS sandbox launcher
      (Linux: rlimits, Landlock, seccomp, namespaces; Windows: Job Object only; see README "Security model").
      If the sandbox cannot be set up, the run continues supervised with a visible notice.
    • Registers process in `RunRegistry` under a unique UUID `run_id`.
                 │
                 ▼
[6. Dual-Cadence Output Throttling & Streaming]
    • Background reader threads pump stdout and stderr.
    • To prevent freezing the UI on `while(1) printf(...)`, output is batched:
         - Flushes every 30 milliseconds OR when buffer hits 8,192 bytes.
         - Hard ceiling: Stops forwarding after 5 MB per run.
    • Emits `run-output` events containing `{ stream: "stdout", chunk: "..." }`.
    • React listens and pushes text directly into xterm.js terminal.
                 │
                 ▼
[7. Watchdog Timer & Escalating Termination]
    • A watchdog thread stops the program after 30 s without input (idle timeout, configurable 1–300 s)
      or 300 s total wall clock; compilation has its own 60 s limit.
    • If timeout occurs or student clicks "Stop":
         - Calls `kill_tree()`:
             1. Sends polite `SIGTERM` to the entire process group.
             2. Waits 500ms grace period for output flush.
             3. Escalates to unconditional `SIGKILL` (or Win32 `taskkill /PID <pid> /T /F`).
                 │
                 ▼
[8. Cleanup & Post-Run Analysis]
    • Emits { phase: "finished", exitCode, timedOut, hint }.
    • If exit code is an abnormal crash (e.g., 139), `crash_hint()` translates it
      into plain English: *"Program crashed - likely a segmentation fault."*
    • Scratch directory is deleted. The student's workspace remains 100% clean.
```

---

# 3. Complete File-by-File & Folder-by-Folder Guide

Here is the exhaustive inventory of every file in CodeUI and why it exists.

---

### 3.1 Root Configuration & Build Files

| File Path | Purpose & Functionality | Why It Is Crucial |
| :--- | :--- | :--- |
| [`Cargo.toml`](file:///d:/CodeUI/Cargo.toml) | Root Cargo workspace manifest. Defines members: `src-tauri` (desktop app) and `xtask` (automation tasks). Configures release profile with `opt-level = 3`, `lto = true` (Link-Time Optimization), and `strip = true`. | Guarantees that the compiled Rust binary is stripped of debug symbols and optimized for minimum size and maximum execution speed. |
| [`Cargo.lock`](file:///d:/CodeUI/Cargo.lock) | Exact dependency lockfile for all Rust crates and sub-dependencies. | Ensures deterministic, reproducible builds across developer machines and lab workstations. |
| [`package.json`](file:///d:/CodeUI/package.json) | Frontend Node.js manifest. Declares dependencies: React 18, `@monaco-editor/react`, `@xterm/xterm`, `@tauri-apps/api`, `lucide-react`, `marked`. | Defines scripts (`npm run dev`, `npm run build`, `npm test`, `npm run tauri`) and tracks locked frontend packages. |
| [`package-lock.json`](file:///d:/CodeUI/package-lock.json) | Exact dependency tree lockfile for npm packages. | Guarantees identical frontend packages across different installations. |
| [`tsconfig.json`](file:///d:/CodeUI/tsconfig.json) | TypeScript compiler options. Configures `strict: true`, JSX mode `react-jsx`, and module resolution for Vite. | Catches type mismatches, null errors, and invalid API calls during development before runtime. |
| [`vite.config.ts`](file:///d:/CodeUI/vite.config.ts) | Vite bundler configuration. Configures React plugin, server port (1420), strict port matching, and test runner environment for Vitest. | Powers fast hot-module replacement (HMR) during dev and bundles clean static assets into `dist/`. |
| [`index.html`](file:///d:/CodeUI/index.html) | Root HTML template. Sets viewport metadata, loads the primary font `"CodeUI Mono"`, and mounts `<div id="root">`. | The entry point loaded inside Tauri's native webview. |
| [`README.md`](file:///d:/CodeUI/README.md) | Official project documentation. Explains installation, architecture, supported languages, team roles, and build commands. | Public face of the repository for developers, teachers, and students. |

---

### 3.2 Rust Backend (`src-tauri/`)

The backend is where security (workspace scoping, execution sandbox), process supervision, filesystem operations, and operating system calls live.

| File Path | Purpose & Functionality | Why It Is Crucial |
| :--- | :--- | :--- |
| [`src-tauri/Cargo.toml`](file:///d:/CodeUI/src-tauri/Cargo.toml) | Declares backend dependencies: `tauri`, `serde`, `portable-pty`, `which`, `dirs`, `rfd` (native file dialogs), `walkdir`, `ureq` (HTTP downloads for extensions), and `zip`. | Supplies the Rust compiler with all required libraries for desktop integration. |
| [`src-tauri/build.rs`](file:///d:/CodeUI/src-tauri/build.rs) | Custom Cargo build script. Extracts Git short commit SHA, build timestamp, target architecture, and profile at compile time, injecting them as `CODEUI_GIT_SHA` and `CODEUI_BUILD_TIME` env vars. Calls `tauri_build::build()`. | Embeds build metadata directly into the executable so the diagnostics screen can show exact version info. |
| [`src-tauri/tauri.conf.json`](file:///d:/CodeUI/src-tauri/tauri.conf.json) | Master Tauri 2.x configuration file. Configures window properties (title, 1280x800, frameless window `decorations: false`), Content Security Policy (CSP), bundle targets, and file associations. | Controls the native desktop window lifecycle, security constraints, and packaging rules. |
| [`src-tauri/ai-policy.json`](file:///d:/CodeUI/src-tauri/ai-policy.json) | Multi-signal policy for known and identifiable AI-assistance extensions. Lists blocked terms (`copilot`, `chatgpt`, `gemini`, `llm`, `deepseek`), blocked extensions IDs (`github.copilot`, `tabnine.tabnine-vscode`), and blocked manifest capability keys (`chatParticipants`, `inlineCompletions`). | Single source of truth shared by the UI and the Rust installer; extension code never runs, so even an undetected extension can only add grammars/themes. |
| [`src-tauri/src/main.rs`](file:///d:/CodeUI/src-tauri/src/main.rs) | Application entry point for the desktop binary. Directly delegates execution to `codeui_lib::run()`. | Standard Tauri architecture separating executable bootstrap from reusable library code. |
| [`src-tauri/src/lib.rs`](file:///d:/CodeUI/src-tauri/src/lib.rs) | Initializes Tauri builder, manages shared state (`RunRegistry`, `PtyManager`, `SettingsStore`), registers all 25+ IPC commands, and binds the window close event to invoke `shutdown()` (killing all student processes). | The central hub linking the Rust modules together and guarding against orphaned processes on window close. |

#### Backend Submodules:

#### A. Commands (`src-tauri/src/commands/`)
- [`mod.rs`](file:///d:/CodeUI/src-tauri/src/commands/mod.rs): Re-exports command submodules (`fs`, `process`, `terminal`, `env_detect`, `settings`, `diagnostics`, `extensions`).
- [`fs.rs`](file:///d:/CodeUI/src-tauri/src/commands/fs.rs): Implements filesystem commands: `read_file`, `write_file`, `list_dir`, `create_file`, `create_dir`, `rename_file`, `delete_file`, `pick_folder`, `pick_file`, `search_files`. Features `is_dangerous_system_path()` to block accidental deletion of root drives (`/` or `C:\`).
- [`process.rs`](file:///d:/CodeUI/src-tauri/src/commands/process.rs): The one-click compile-and-run supervisor. Coordinates runner dispatch, compilation, process group spawning, 30ms output batching, 5MB output ceiling, stdin writing, and watchdog cancellation.
- [`terminal.rs`](file:///d:/CodeUI/src-tauri/src/commands/terminal.rs): Handles PTY IPC commands: `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`, `list_pty_sessions`, `get_default_shell`.
- [`env_detect.rs`](file:///d:/CodeUI/src-tauri/src/commands/env_detect.rs): Scans `$PATH` for compiler toolchains (`gcc`, `g++`, `python`, `javac`, `java`, `rustc`, `cargo`, `go`, `sf`). Returns friendly status and exact install hints if missing.
- [`settings.rs`](file:///d:/CodeUI/src-tauri/src/commands/settings.rs): Manages persistent JSON configuration in the user's config directory (`settings.json`). Handles font size, tab width, editor theme, and default shell.
- [`diagnostics.rs`](file:///d:/CodeUI/src-tauri/src/commands/diagnostics.rs): Collects system diagnostics (OS, architecture, active PTYs, tool status, git SHA) for troubleshooting.
- [`extensions.rs`](file:///d:/CodeUI/src-tauri/src/commands/extensions.rs): Downloads extensions from Open VSX, parses VSIX archives, enforces `ai-policy.json`, and extracts **only declarative syntax grammars and themes**, dropping any executable JavaScript.

#### B. Process & Sandboxing (`src-tauri/src/proc/`)
- [`sandbox.rs`](file:///d:/CodeUI/src-tauri/src/proc/sandbox.rs): OS restrictions for the run phase (Linux rlimits/Landlock/seccomp/namespaces, macOS `sandbox-exec`, Windows Job Object) and the status report shown in Copy Diagnostics.
- [`mod.rs`](file:///d:/CodeUI/src-tauri/src/proc/mod.rs): Implements `detach_process_group()` (gives each run its own process group), `crash_hint()` (maps exit codes 139, 136, 137 to plain-language explanations), and `take_utf8()` (prevents multi-byte Unicode truncation across chunk reads).
- [`kill.rs`](file:///d:/CodeUI/src-tauri/src/proc/kill.rs): Escalating termination engine (`kill_tree`). Dispatches `SIGTERM`, waits 500ms, and escalates to `SIGKILL` on Unix; uses `taskkill /PID <pid> /T /F` on Windows.
- [`toolpath.rs`](file:///d:/CodeUI/src-tauri/src/proc/toolpath.rs): Augments `$PATH` to ensure standard compiler paths (e.g., `/usr/bin`, `/usr/local/bin`, Windows MinGW paths) are checked even if the desktop environment launched with a sparse environment.

#### C. Pseudo-Terminal (`src-tauri/src/pty/`)
- [`mod.rs`](file:///d:/CodeUI/src-tauri/src/pty/mod.rs): Manages native PTY sessions via `portable-pty`. Opens master/slave PTY pairs, spawns shell sessions (bash, zsh, powershell), bridges data streams, and handles `resize()` (`TIOCSWINSZ`) so full-screen terminal programs render properly.

#### D. Language Runners (`src-tauri/src/runners/`)
- [`runner_trait.rs`](file:///d:/CodeUI/src-tauri/src/runners/runner_trait.rs): Defines the `LanguageRunner` trait with `compile()` and `execute()`, plus the `RunContext` structure (source, scratch dir, workdir).
- [`c.rs`](file:///d:/CodeUI/src-tauri/src/runners/c.rs): Compiles C using `gcc`/`clang` with `-Wall -g` into the scratch folder and executes the resulting binary.
- [`cpp.rs`](file:///d:/CodeUI/src-tauri/src/runners/cpp.rs): Compiles C++ using `g++`/`clang++` with `-Wall -g` into the scratch folder.
- [`java.rs`](file:///d:/CodeUI/src-tauri/src/runners/java.rs): Scans Java source to find class declarations and `package` statements. Verifies that public class names match the filename before compiling, avoiding confusing `javac` errors, and executes with `java -cp <scratch> package.ClassName`.
- [`python.rs`](file:///d:/CodeUI/src-tauri/src/runners/python.rs): Runs Python with `-u` (unbuffered stdout/stderr) so interactive input prompts show up immediately.
- [`salivo.rs`](file:///d:/CodeUI/src-tauri/src/runners/salivo.rs): Invokes the Salivo compiler (`sf build`) in the scratch directory and executes the compiled binary.
- [`mod.rs`](file:///d:/CodeUI/src-tauri/src/runners/mod.rs): Maps file extensions to their registered `LanguageRunner`.

---

### 3.3 Frontend Core & State (`src/`)

| File Path | Purpose & Functionality | Why It Is Crucial |
| :--- | :--- | :--- |
| [`src/main.tsx`](file:///d:/CodeUI/src/main.tsx) | React application bootstrap. Registers Monarch syntax languages, mounts `<App />` into the DOM root, and handles global unhandled errors. | Ensures languages are registered before any editor component renders. |
| [`src/App.tsx`](file:///d:/CodeUI/src/App.tsx) | Main UI layout. Assembles TitleBar, ActivityBar, Sidebar, SplitEditorContainer, RunDebugBar, TerminalPanel, and StatusBar. Handles window drag, modals, and panel sizing. | The master UI container governing application screen space. |
| [`src/monaco.ts`](file:///d:/CodeUI/src/monaco.ts) | Custom Monaco Editor wrapper. Configures worker loading paths, loads TextMate grammars, and prepares Monaco instances. | Bridges Monaco Editor into Vite's module bundling model. |
| [`src/editorRuntime.ts`](file:///d:/CodeUI/src/editorRuntime.ts) | Manages runtime editor models and view states so tabs preserve cursor position, scroll offsets, and undo history when switching. | Prevents loss of editor state when switching between open tabs. |
| [`src/index.css`](file:///d:/CodeUI/src/index.css) | Core stylesheet. Custom design tokens, typography, dark mode palette, scrollbar styles, xterm styling, and responsive layout classes. | Provides the dark, modern, distraction-free aesthetic. |
| [`src/store/useWorkspaceStore.ts`](file:///d:/CodeUI/src/store/useWorkspaceStore.ts) | Global workspace store (custom reactive hook). Manages workspace path, file tree, open files, active tab, split editor state, unsaved dirty states, and execution status. | The central brain of the frontend state. |
| [`src/types/index.ts`](file:///d:/CodeUI/src/types/index.ts) | Central TypeScript type definitions: `FileEntry`, `OpenFile`, `ToolStatus`, `UserSettings`, `ExtensionItem`, `RunStatus`. | Enforces strict type checking across all frontend services and components. |

---

### 3.4 Frontend Services (`src/services/`)

| File Path | Purpose & Functionality | Why It Is Crucial |
| :--- | :--- | :--- |
| [`aiPolicy.ts`](file:///d:/CodeUI/src/services/aiPolicy.ts) | Frontend AI policy evaluator. Normalizes extension names and descriptions to detect and block AI extensions in the catalog UI. | Mirrors backend security rules in the user interface. |
| [`diagnostics.ts`](file:///d:/CodeUI/src/services/diagnostics.ts) | Pure TypeScript compiler error parser. Parses stderr from `gcc`, `javac`, and `python`, returning line and column numbers. Sets squiggly error markers in Monaco. | Turns cryptic raw compiler errors into visual red squigglies on exact lines. |
| [`editorService.ts`](file:///d:/CodeUI/src/services/editorService.ts) | Singleton managing active Monaco editor references, layout recalculations, format commands, and line jumps. | Allows non-editor components (like error panels) to command the editor to jump to lines. |
| [`envService.ts`](file:///d:/CodeUI/src/services/envService.ts) | Frontend wrapper around Tauri's `detect_tools` command. Caches tool availability. | Informs the user immediately if GCC or Python is missing from the computer. |
| [`extensionHost.ts`](file:///d:/CodeUI/src/services/extensionHost.ts) | Safe declarative extension consumer. Injects TextMate themes and syntax grammars into Monaco without executing extension JavaScript. | Extends editor capabilities without violating lab safety. |
| [`extensionService.ts`](file:///d:/CodeUI/src/services/extensionService.ts) | Queries the Open VSX marketplace API and coordinates with Tauri backend commands to install, uninstall, and toggle extensions. | Powers the extension catalog browser. |
| [`fsService.ts`](file:///d:/CodeUI/src/services/fsService.ts) | Typed frontend wrapper around Tauri's filesystem IPC commands (`read_file`, `write_file`, `list_dir`, etc.). Includes web-mode fallbacks for browser testing. | The single gateway for all frontend file operations. |
| [`notify.ts`](file:///d:/CodeUI/src/services/notify.ts) | Custom toast notification dispatcher (`notify.success`, `notify.error`, `notify.info`). | Displays non-intrusive feedback toasts in the top-right corner. |
| [`processService.ts`](file:///d:/CodeUI/src/services/processService.ts) | Wraps Tauri's `run_file`, `stop_run`, and `write_run_stdin` commands. Listens for streaming `run-output` events. | Drives the Run button and streams process stdout/stderr into the terminal. |
| [`ptyService.ts`](file:///d:/CodeUI/src/services/ptyService.ts) | Manages terminal PTY lifecycle over Tauri IPC. Dispatches keystrokes to Rust and receives terminal escape codes. | Powers the interactive integrated terminal. |
| [`settingsService.ts`](file:///d:/CodeUI/src/services/settingsService.ts) | Loads and saves user preferences (`load_settings`, `save_settings`) over IPC. | Keeps student font and theme preferences persisted across reboots. |
| [`terminalReady.ts`](file:///d:/CodeUI/src/services/terminalReady.ts) | Promise-based synchronization primitive ensuring terminal commands aren't dispatched before xterm finishes mounting. | Prevents race conditions during startup. |

---

### 3.5 UI Components (`src/components/`)

#### Shell (`src/components/shell/`)
- [`TitleBar.tsx`](file:///d:/CodeUI/src/components/shell/TitleBar.tsx): Custom frameless title bar. Includes project title, current open folder, quick-open trigger, diagnostic report button, and native window minimize/maximize/close controls.
- [`ActivityBar.tsx`](file:///d:/CodeUI/src/components/shell/ActivityBar.tsx): Leftmost vertical icon strip. Toggles Explorer, Search, Run, Extensions, and Settings views.
- [`Sidebar.tsx`](file:///d:/CodeUI/src/components/shell/Sidebar.tsx): Collapsible sidebar container hosting the active panel (File Explorer, Search, etc.).
- [`StatusBar.tsx`](file:///d:/CodeUI/src/components/shell/StatusBar.tsx): Bottom bar. Displays current language, encoding (UTF-8), indentation (Spaces: 4), line/column coordinates, compiler error/warning counts, and toolchain status.
- [`Toasts.tsx`](file:///d:/CodeUI/src/components/shell/Toasts.tsx): Floating toast notification overlay.

#### Editor (`src/components/editor/`)
- [`MonacoEditorGroup.tsx`](file:///d:/CodeUI/src/components/editor/MonacoEditorGroup.tsx): Wraps `@monaco-editor/react`. Applies zero-assistance lockdown, binds editor markers, and synchronizes document changes with the workspace store.
- [`SplitEditorContainer.tsx`](file:///d:/CodeUI/src/components/editor/SplitEditorContainer.tsx): Manages side-by-side split editor panes, allowing students to view two files simultaneously (e.g., a header file and an implementation file).
- [`TabStrip.tsx`](file:///d:/CodeUI/src/components/editor/TabStrip.tsx): Top tab bar. Shows open files, active tab indicator, unsaved dirty dots, close buttons, and split-pane action buttons.
- [`RunDebugBar.tsx`](file:///d:/CodeUI/src/components/editor/RunDebugBar.tsx): One-click Run / Stop action bar above the editor. Shows execution spinner and elapsed duration.
- [`monacoSafeDefaults.ts`](file:///d:/CodeUI/src/components/editor/monacoSafeDefaults.ts): **The most critical safety file in the project.** Contains `MONACO_LAB_SAFE_OPTIONS`, `applyZeroSuggestionsLockdown()`, and `blockManualSuggestionShortcuts()`, permanently stripping all autocomplete, hover tips, parameter hints, and completion keybindings.

#### Explorer & Panels
- [`FileTree.tsx`](file:///d:/CodeUI/src/components/explorer/FileTree.tsx): Interactive tree view. Supports expanding/collapsing folders, creating files/folders, renaming, deleting, and file-opening.
- [`SearchPanel.tsx`](file:///d:/CodeUI/src/components/explorer/SearchPanel.tsx): Full-workspace text search with line previews and click-to-navigate.
- [`RunPanel.tsx`](file:///d:/CodeUI/src/components/explorer/RunPanel.tsx): Shows toolchain environment status (GCC, Python, Java) and run configuration parameters.
- [`TerminalPanel.tsx`](file:///d:/CodeUI/src/components/terminal/TerminalPanel.tsx): Houses `xterm.js`. Handles terminal tab management, window resizing (`addon-fit`), and interactive terminal I/O.
- [`PreviewPanel.tsx`](file:///d:/CodeUI/src/components/preview/PreviewPanel.tsx): Live HTML/CSS/JavaScript sandboxed preview pane with an auto-refresh toggle.
- [`QuickOpenModal.tsx`](file:///d:/CodeUI/src/components/palette/QuickOpenModal.tsx): `Ctrl+P` modal to quickly search and switch between files by name.
- [`SettingsModal.tsx`](file:///d:/CodeUI/src/components/settings/SettingsModal.tsx): Modal dialog for configuring font size, tab width, editor theme, and default shell.
- [`WelcomeView.tsx`](file:///d:/CodeUI/src/components/welcome/WelcomeView.tsx): Clean splash screen displayed when no folder is open. Offers Open Folder and Recent Files buttons.
- [`ExtensionsPanel.tsx`](file:///d:/CodeUI/src/components/extensions/ExtensionsPanel.tsx): Curated extension marketplace browser. Filters out AI tools and labels lab-safe themes/grammars.
- [`FileIcon.tsx`](file:///d:/CodeUI/src/components/icons/FileIcon.tsx): Renders custom file-type icons based on file extensions (C, C++, Java, Python, HTML, etc.).

---

### 3.6 Languages, Utilities & Data

- [`registerAllLanguages.ts`](file:///d:/CodeUI/src/languages/registerAllLanguages.ts): Eagerly imports and registers built-in Monaco Monarch definitions for C, C++, Python, Java, Rust, Go, Zig, HTML, CSS, SQL, and Shell, ensuring instant syntax highlighting without external network requests.
- [`salivoMonaco.ts`](file:///d:/CodeUI/src/languages/salivoMonaco.ts): Custom Monarch syntax definition for the Salivo language (stream imports `><`, keywords, types, string interpolation).
- [`extLanguageMap.ts`](file:///d:/CodeUI/src/languages/extLanguageMap.ts): Maps arbitrary file extensions to Monarch language IDs.
- [`path.ts`](file:///d:/CodeUI/src/utils/path.ts): Cross-platform path utility functions (`join`, `dirname`, `basename`, `isInside`, `validateName`).
- [`fontCheck.ts`](file:///d:/CodeUI/src/utils/fontCheck.ts): Checks if the custom monospace font is loaded; falls back smoothly to system monospace.
- [`sanitizeHtml.ts`](file:///d:/CodeUI/src/utils/sanitizeHtml.ts): Sanitizes HTML content for the preview pane, blocking malicious script injection.
- [`extensionsData.ts`](file:///d:/CodeUI/src/data/extensionsData.ts): Static curated catalog of popular lab-safe extensions and themes.

---

### 3.7 Automation Tooling (`xtask/`)

- [`xtask/Cargo.toml`](file:///d:/CodeUI/xtask/Cargo.toml): Manifest for the workspace automation crate.
- [`xtask/src/main.rs`](file:///d:/CodeUI/xtask/src/main.rs): Pure Rust build automation tool.
  - `version-sync`: Synchronizes version numbers across `Cargo.toml`, `package.json`, and `tauri.conf.json`.
  - `audit-no-python`: Scans the entire codebase and fails if any `.py` script is found in the tooling or build pipelines (enforcing the strict no-Python-tooling policy).
  - `check-conflicts`: Validates that no merge conflict markers exist in source files.

---

# 4. Deep-Dive Technical Concepts

When an examiner tests your deep technical understanding, these are the mechanisms they probe:

### Concept 1: Pseudo-Terminal (PTY) vs Standard Redirected Pipes
- **The Problem:** In simple programs like `scanf("%d", &x);` or Python's `input("Name: ")`, C and Python check whether standard output is connected to a terminal (via `isatty()`). If it is a redirected pipe (like standard IDE output panes), the operating system enables **block buffering**. The prompt string stays stuck in the memory buffer until the program exits! The student sees a blank screen, doesn't realize input is expected, and the program appears to freeze.
- **The CodeUI Solution:** CodeUI uses `portable-pty` on Rust to allocate a real OS pseudo-terminal master/slave pair (ConPTY on Windows, `/dev/pts` on Linux). The runtime recognizes it as an interactive terminal, disables block buffering, and displays prompts instantly. Moreover, programs like `vim`, `nano`, or `top` work seamlessly because escape sequences (ANSI/VT100) are fully supported.

### Concept 2: Process Group Detachment & Kill Escalation
- **The Problem:** If a student writes an infinite loop or spawns child processes (e.g., using `fork()`), killing only the parent process by PID leaves orphaned child processes running in the background, consuming 100% CPU on shared lab computers.
- **The CodeUI Solution:**
  1. *Detachment:* When launching the process, Rust calls `libc::setsid()` (on Unix) or `CREATE_NEW_PROCESS_GROUP` (on Windows). The child becomes the leader of its own process group.
  2. *Escalating Termination (`kill_tree`):* CodeUI signals the **entire process group** (`killpg(pid, SIGTERM)` on Unix; `taskkill /PID <pid> /T /F` on Windows). It waits 500ms for graceful cleanup, and if any process remains alive, escalates to `SIGKILL`.

### Concept 3: The 30ms / 8KB / 5MB Output Throttling Engine
- **The Problem:** A student accidentally writes:
  ```c
  while(1) { printf("infinite loop\n"); }
  ```
  This emits millions of lines per second. If an IDE emits an IPC event for every print, the IPC bridge saturates, the webview memory skyrockets, and the application freezes or crashes.
- **The CodeUI Solution:** In `src-tauri/src/commands/process.rs`, reader threads push characters into a thread-safe buffer. Output is flushed to the frontend only on a **30-millisecond cadence** or when the buffer hits **8,192 bytes**. In addition, a strict **5 Megabyte per-run ceiling** (`OUTPUT_CAP`) drops further output and warns the student, protecting the computer's memory.

### Concept 4: The Zero-Assistance Neutralization Pattern
- **The Problem:** Microsoft's Monaco Editor is the same core that powers VS Code. By default, it aggressively registers completion item providers, parameter hints, word suggestions, and lightbulb code actions.
- **The CodeUI Solution:** In `monacoSafeDefaults.ts`:
  1. Every suggestion flag in Monaco's configuration is explicitly set to `false`, `"off"`, or `"never"`.
  2. `applyZeroSuggestionsLockdown()` monkey-patches Monaco's `languages.registerCompletionItemProvider` and related functions, returning dummy disposables. Even if an extension tries to register autocomplete, Monaco discards it.
  3. All manual shortcut commands (`Ctrl+Space`, `Alt+Enter`, `F12`, `F2`) are bound to empty no-op functions on editor mount.

---

# 5. Teacher & Examiner Viva Voce Q&A Bank

Prepare these answers thoroughly. They represent the most likely and challenging questions an examiner will ask.

---

### Category A: Problem & Purpose

#### Q1: "Why did you build this project? Doesn't VS Code already exist?"
> **Answer:** *"Sir/Ma'am, VS Code is built for commercial developer productivity, not academic examination integrity. VS Code includes built-in IntelliSense, autocomplete, parameter hints, and AI extensions that suggest code to students during practical exams. Because of this, college labs ban VS Code and force students to use Notepad or gedit, which strips away syntax highlighting, integrated terminals, and error markers. CodeUI is specifically engineered to fill this gap: it provides the ergonomics of a modern IDE while guaranteeing zero autocomplete, zero suggestions, and zero AI assistance."*

#### Q2: "Why couldn't you just disable autocomplete in VS Code settings?"
> **Answer:** *"In VS Code, disabling autocomplete is merely a user preference in `settings.json`. Any student can open settings or press `Ctrl+,` and re-enable it in 5 seconds during an exam. Furthermore, VS Code has a vast marketplace from which students can install Copilot or ChatGPT. In CodeUI, the zero-assistance lockdown is hardcoded at both the Monaco engine level and the Rust backend, making it impossible for a student to turn suggestions back on."*

---

### Category B: Architecture & Tech Stack

#### Q3: "Why did you choose Tauri and Rust instead of Electron and Node.js?"
> **Answer:** *"We chose Tauri and Rust for three decisive reasons:*
> 1. ***Memory Footprint:*** *Electron bundles an entire Chromium browser and Node.js runtime, consuming 300MB–500MB of RAM at idle. Tauri uses the operating system's native webview and a compiled Rust backend, consuming only ~60MB–80MB of RAM. This is crucial for aging college lab computers with only 4GB of RAM.*
> 2. ***Binary Size:*** *An Electron installer is typically 150MB+, whereas CodeUI's installer is only ~15MB.*
> 3. ***Low-Level Process Control:*** *Rust allows direct POSIX system calls (`libc::setsid`, `libc::killpg`) and Win32 APIs (Job Objects) for robust process-group supervision, OS-level sandboxing and watchdog management, which cannot be achieved reliably from Node.js."*

#### Q4: "How does the frontend communicate with the backend in Tauri?"
> **Answer:** *"Communication occurs over Tauri's asynchronous Inter-Process Communication (IPC) bridge in two ways:*
> 1. ***Commands (`invoke`):*** *The frontend calls typed Rust functions decorated with `#[tauri::command]`, such as `read_file` or `run_file`, returning Promises.*
> 2. ***Event Streaming (`emit`/`listen`):*** *For continuous data—such as terminal character streams or compiler output batches—the Rust backend emits events (e.g., `run-output`, `pty-data:<id>`), and React listeners receive them in real time without polling."*

---

### Category C: Operating Systems & Process Control

#### Q5: "What happens if a student writes an infinite loop like `while(1);`? Will it crash your IDE?"
> **Answer:** *"No, Sir/Ma'am. CodeUI has a multi-layered defense:*
> 1. *Student programs are executed in a separate child process with OS resource limits (CPU time, memory), completely decoupled from the IDE's UI thread.*
> 2. *A watchdog stops the program after 30 seconds without input (idle timeout) or 300 seconds in total.*
> 3. *The student can click the 'Stop' button at any time.*
> 4. *Termination invokes `kill_tree()`, which sends `SIGTERM`, waits a 500ms grace period, and escalates to unconditional `SIGKILL` (or Win32 `taskkill /PID <pid> /T /F`), cleanly terminating the process."*

#### Q6: "What happens if a student writes an infinite print loop like `while(1) printf("hello");`?"
> **Answer:** *"In naive IDEs, this floods the IPC channel and crashes the webview. CodeUI prevents this using **dual-cadence stream throttling**: output is buffered in Rust and flushed to the frontend only once every 30 milliseconds or when 8KB of data accumulates. Additionally, we enforce a strict **5MB output ceiling** per run. If exceeded, the stream stops forwarding and alerts the student, preventing memory exhaustion."*

#### Q7: "What is an orphaned process, and how does CodeUI prevent them?"
> **Answer:** *"If a child process spawns background sub-processes (for example, via `fork()`), killing only the parent leaves the sub-processes running as 'orphans'. In CodeUI, we call `libc::setsid()` on Linux and `CREATE_NEW_PROCESS_GROUP` on Windows during process spawning. This assigns all child processes to a dedicated **process group**. When we terminate, we signal the entire process group (`killpg`), ensuring every single child is terminated."*

#### Q8: "What happens to running processes if a student abruptly closes the CodeUI window?"
> **Answer:** *"In `src-tauri/src/lib.rs`, we intercept the window event `tauri::WindowEvent::CloseRequested`. Before the window is destroyed, we invoke `shutdown()`, which calls `shutdown_all()` on both `RunRegistry` and `PtyManager`. Every running student process and open PTY shell is terminated immediately, leaving the lab workstation completely clean."*

---

### Category D: Compiler Runners & Languages

#### Q9: "How does CodeUI compile and run C and C++ programs?"
> **Answer:** *"When a student clicks Run on a `.c` or `.cpp` file, `CRunner` or `CppRunner` resolves the local compiler (`gcc` or `g++`). It compiles the code with `-Wall -g` and outputs the executable into a **per-run scratch directory** (`/tmp/codeui-xyz`). If compilation succeeds, it executes the binary in a detached process group, setting the current working directory to the student's project folder so relative file paths work properly."*

#### Q10: "Why compile to a scratch directory instead of the project directory?"
> **Answer:** *"In college labs, students' folders often become cluttered with `.o`, `.class`, `.exe`, or `a.out` binaries, causing confusion during evaluation and Git submissions. By compiling into a temporary scratch directory and executing from there, the student's source folder remains 100% clean."*

#### Q11: "What is special about how CodeUI executes Python code?"
> **Answer:** *"CodeUI executes Python with the `-u` flag (e.g., `python3 -u script.py`). By default, Python enables block buffering on stdout when connected to a pipe. Without `-u`, prompts like `input("Enter number: ")` do not appear on the screen until after input is entered. The `-u` flag forces unbuffered binary stdout and stderr, guaranteeing that interactive prompts display immediately."*

#### Q12: "How does CodeUI handle Java's strict public class naming rule?"
> **Answer:** *"Java requires that a public class must match its filename (e.g., `public class Main` must be in `Main.java`). Students frequently rename files and get cryptic `javac` errors. In `java.rs`, CodeUI parses the Java file before compilation, detects class names and `package` declarations, and validates that any public class matches the file stem. If it doesn't, CodeUI displays a clear, actionable warning before even invoking `javac`. It also passes the fully qualified package name to `java -cp <scratch>`."*

---

### Category E: Frontend & Monaco Lockdown

#### Q13: "How did you disable autocomplete in Monaco Editor if Monaco has autocomplete built-in?"
> **Answer:** *"We disabled it at three distinct layers in `monacoSafeDefaults.ts`:*
> 1. ***Configuration Options:*** *We set all suggestion properties (`quickSuggestions`, `suggestOnTriggerCharacters`, `wordBasedSuggestions`, `parameterHints`, `snippetSuggestions`) to `false` or `'off'`.*
> 2. ***API Interception:*** *In `applyZeroSuggestionsLockdown()`, we override Monaco's internal provider registration methods (`registerCompletionItemProvider`, `registerHoverProvider`, `registerDefinitionProvider`) with dummy no-op functions.*
> 3. ***Keyboard Shortcut Overrides:*** *We intercept keystrokes like `Ctrl+Space`, `Alt+Enter`, `F12`, and `F2`, binding them to empty handlers so no shortcut can trigger completions."*

#### Q14: "How does CodeUI display red squiggly error markers under code?"
> **Answer:** *"When a compiler produces errors on stderr, our pure TypeScript parser in `src/services/diagnostics.ts` parses the output using regular expressions:
> - For GCC/Clang: It extracts `filename:line:column: error: message`.
> - For Javac: It identifies the line number and the caret (`^`) position on subsequent lines.
> - For Python: It parses the traceback stack frame.
> It normalizes the file path and calls Monaco's `monaco.editor.setModelMarkers()`, painting native red and yellow squiggly lines on the exact line and column where the error occurred."*

---

### Category F: Security & Extensions

#### Q15: "Can a student install an AI extension like GitHub Copilot or ChatGPT?"
> **Answer:** *"No, Sir/Ma'am. It is blocked at two independent levels:*
> 1. ***Frontend UI Filtering:*** *The marketplace search evaluates names, descriptions, and manifest tags against `ai-policy.json`. AI tools are rejected and marked as blocked by lab policy.*
> 2. ***Backend Rust Enforcement:*** *When downloading a VSIX package from Open VSX in `commands/extensions.rs`, the Rust backend inspects the package manifest. If any AI keywords, blocked extension IDs, or AI capabilities (like `chatParticipants` or `languageModels`) are present, the installation is rejected with a `Blocked by lab policy` error. It is a multi-signal policy for known and identifiable AI extensions, so it cannot promise to catch every one. Furthermore, CodeUI **only extracts declarative syntax grammars and themes**; it never executes third-party extension JavaScript code."*

#### Q15b: "Is student code sandboxed?"
> **Answer:** *"Partly, depending on the OS. On Linux the run phase gets rlimits, no_new_privs, a network namespace, Landlock (writes only to the project, scratch, /tmp and /dev; home folders like ~/.ssh unreadable) and seccomp (no IPv4/IPv6 sockets) where the kernel supports each. On Windows it is **supervised, not sandboxed**: a Job Object limits CPU time, memory and process count, but network and files are not isolated. Compilation is supervised only. Help > Copy Diagnostics shows what this machine enforces; the README's Security model section has the details."*

#### Q16: "What is the purpose of the `xtask` crate in your repository?"
> **Answer:** *"The `xtask` crate is a native Rust automation tool that enforces our project's **No-Python-Tooling** architectural policy. Instead of using Python or Bash scripts for version syncing and codebase maintenance, we use `cargo run -p xtask -- <task>`. It handles tasks like synchronizing version numbers across `Cargo.toml`, `package.json`, and `tauri.conf.json`, and running `audit-no-python` to verify no stray `.py` build scripts exist in the repository."*

---

### Category G: Quick-Fire Technical Questions

| Question | Short, Confident Answer |
| :--- | :--- |
| **Q17: What does exit code 139 mean?** | *"It is a Segmentation Fault (SIGSEGV, 128 + 11). CodeUI detects this and shows: 'Program crashed - likely invalid memory access.'"* |
| **Q18: What does exit code 136 mean?** | *"It is an Arithmetic Exception (SIGFPE, 128 + 8), typically a division by zero."* |
| **Q19: What does exit code 137 mean?** | *"The process was killed by SIGKILL (128 + 9), usually by CodeUI's watchdog after the idle timeout (default 30 s) or the 300 s maximum run time."* |
| **Q20: Why did you use `portable-pty`?** | *"To create real operating system pseudo-terminals on both Windows (ConPTY) and Linux (`/dev/pts`), enabling full terminal escape sequence handling and interactive prompts."* |
| **Q21: How do you handle HTML/CSS preview?** | *"Through a sandboxed `<iframe>` (`allow-scripts allow-modals`, no same-origin) in `PreviewPanel.tsx` with an injected CSP. Known limit: the preview inherits the app CSP, so inline `<script>` may not run in the built app."* |
| **Q22: What state management library do you use?** | *"We use a custom reactive Zustand-style store hook in `src/store/useWorkspaceStore.ts`, keeping bundle size minimal while providing clean reactive state across tabs, file tree, and execution status."* |
| **Q23: How do you test your application?** | *"We run `cargo test --workspace` for the Rust backend (process supervision, sandbox, workspace scoping, signal handling, UTF-8 streaming) and `npm test` with Vitest for the frontend (Monaco lockdown, diagnostics regex parsers, path utils)."* |
| **Q24: Can CodeUI open large project folders?** | *"Yes, `fs.rs` lists directories lazily on expand, avoiding loading deep directory trees into memory all at once."* |
| **Q25: What happens if a compiler is missing?** | *"On startup, `env_detect.rs` checks `$PATH`. If GCC or Python is missing, CodeUI displays a yellow warning banner and provides the exact install command (e.g., `sudo apt install build-essential` or `winget install Python`)."* |

---

# 6. Final Exam Readiness Checklist

Before your presentation or viva, make sure you know:
- [x] Where `PROJECT_SYNOPSIS.md` is located (in the root directory for printing/submission).
- [x] Where `CODEBASE_STUDY_GUIDE.md` is located (in the root directory for last-minute review).
- [x] The exact 2-minute elevator pitch in Section 1.
- [x] The 8-step execution flow diagram in Section 2.
- [x] The 4 deep-dive concepts (PTY, Process Group Detachment, Throttling, Zero-Assistance).
- [x] The top 10 Viva Voce questions in Section 5.

**You are 100% prepared to answer any technical question with authority.**
