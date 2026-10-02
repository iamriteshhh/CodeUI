# CodeUI — Implementation Plan (v0.2, Expanded)

Status: Planning document only. No application code has been written. This document is the technical blueprint for development. This revision expands every section of v0.1 with implementation-level detail, diagrams, and worked examples. **No new scope has been added** — everything below elaborates a requirement, module, or decision that already existed in v0.1.

---

## 0. How to Read This Plan

- Every top-level section number matches the original v0.1 plan, so the two documents stay cross-referenceable.
- Diagrams referenced inline live in `images/` alongside this file and are embedded directly below the section they illustrate.
- Tables are the primary format for anything enumerable (modules, phases, risks, tests) so they stay scannable and diffable in version control.
- A companion file, `prompt.md`, turns this plan into a single, extremely detailed instruction set an AI coding assistant (Claude Code, Cursor, etc.) can be handed directly to implement the project phase by phase.
- **Build-language policy (read this first):** CodeUI is built with **Rust** (Tauri core) and **TypeScript/Node.js** (React frontend, tooling, tests). **Python is not used anywhere in the construction, scripting, tooling, CI, or automation of CodeUI itself.** Python appears exactly once in this entire plan: as `python3`, one of the four languages CodeUI lets a *student* execute. That distinction is expanded in Section 3.1 and illustrated below.

![Build vs. runtime language policy](images/build_vs_runtime_languages.png)

---

## 1. Project Overview

**CodeUI** is a Linux-first desktop Integrated Development Environment (IDE) built specifically for college computer laboratories.

**The problem, in more detail:** Many college labs restrict students to bare text editors (e.g. Notepad, gedit, nano) during programming practicals, because modern IDEs like VS Code provide autocomplete and code suggestions that colleges consider a form of cheating during assessment. This is a real and reasonable institutional concern — an assessment intended to test whether a student can write a `for` loop from memory is undermined if the editor writes half of it for them. But the current response to that concern is disproportionate: it strips away *everything* an editor provides, not just the parts that are actually assistance. The result is that students do timed lab exercises without:
- syntax highlighting (so a missing semicolon or unclosed brace is invisible until compile time),
- an integrated terminal (so running a program means alt-tabbing to a separate terminal emulator and re-navigating to the right directory every time),
- real file management (so organizing a multi-file project means using the OS file manager or raw shell commands),
- readable error output (so a segfault or a stack trace is whatever the bare terminal happens to print, with no formatting).

None of these are "assistance" in the sense the college is trying to prevent. They are baseline tooling that any professional developer has, and their absence makes lab time harder without making assessment more honest.

**Target users, in more detail:**
- **Primary:** undergraduate CS/IT students doing programming lab practicals on shared Ubuntu lab machines, working in C, C++, Python, Java, or basic web development.
- **Secondary:** lab instructors/TAs who need to trust that the tool in front of students cannot silently produce or suggest code.
- **Not targeted (explicitly):** professional developers looking for a daily-driver IDE, students working outside a lab-assessment context who would benefit from full IDE tooling, Windows/macOS users (v0.1 is Linux-only, see Section 2).

**v0.1 goal, restated precisely:** Give students a clean, reliable, lightweight programming environment — editor, file explorer, integrated terminal, and run/compile for C, C++, Python, Java, and basic web development — with **no automated coding assistance of any kind, ever**. CodeUI is not trying to replace VS Code as a general-purpose IDE; it exists to fill one specific, narrow gap: *lab-safe tooling that still behaves like a real editor.*

**What "success" looks like concretely:** a student who has only ever used Notepad in a lab sits down at a machine running CodeUI, opens a `.c` file, sees it highlighted correctly, edits it, presses Run, and sees compiler errors or program output in under a few seconds — without needing to be taught anything beyond "this is like a text editor with a Run button."

---

## 2. Product Scope

### 2.1 In scope for v0.1 (expanded)

| Capability | What "done" looks like at a detail level |
|---|---|
| Code editor | Syntax highlighting for C, C++, Python, Java, HTML/CSS/JS; line numbers; bracket/brace matching with visual highlight of the matching pair; auto-indent on newline matching the previous line's indentation; multiple tabs with unsaved-change (dirty) indicators; find/replace with case-sensitivity and whole-word toggles; file create/open/save/save-as/rename/delete from within the editor |
| File/project explorer | Tree view of the open folder; expand/collapse directories; create file/folder, rename, delete (with confirmation), drag-free flat operations for v0.1 (drag-and-drop move is not required) |
| Integrated terminal | One or more real shell sessions inside the app window; no separate terminal emulator ever required for any v0.1 workflow, including interactive stdin programs |
| Run/Compile | One-click compile+run for C and C++; one-click run for Python; one-click compile+run for Java; clear separation of compiler errors vs. runtime errors vs. successful output |
| Web dev support | Edit HTML/CSS/JS with syntax highlighting; local preview pane that reflects saved changes |
| Environment detection | On startup and on demand, check for `gcc`, `g++`, `python3`, `javac`/`java`, and a usable browser/webview; report exactly which are missing, not just "something is wrong" |
| Basic settings | Font size, editor theme (at least light/dark), tab width, default shell path; persisted across restarts |
| Linux packaging | A build artifact a lab machine can actually install and run (Section 13) |

### 2.2 Explicitly excluded from v0.1 (expanded, with reasoning)

| Excluded item | Why it's excluded now (not "why it's bad") |
|---|---|
| AI coding assistant, autocomplete, suggestions, IntelliSense-style assistance | This is the entire reason CodeUI exists — the one feature that must never appear, even accidentally via a bundled editor library's default behavior (see Section 5, Code Editor module) |
| Admin panel, teacher dashboard, student dashboard, accounts | No backend, no auth system, no multi-user concept in v0.1 — CodeUI is a single-user local desktop app |
| Cloud sync, SaaS infrastructure | Would require accounts, a backend, and a security posture entirely disproportionate to the problem being solved |
| Automatic grading, rankings/leaderboards, analytics, monitoring/surveillance | Explicitly avoided so CodeUI cannot be perceived — or used — as a surveillance tool; this is a trust-building decision as much as a scoping one |
| Git integration, extension marketplace | Both are significant subsystems in their own right; neither is needed for "edit, run, see output" |
| Mobile application | Lab machines are desktop Ubuntu; there is no mobile use case in scope |
| Any language beyond C, C++, Python, Java, Web | Matches the actual college curriculum surface; adding a language means adding a full runner + test matrix (Section 6, Section 11) |

### 2.3 Possibly future (not committed, not designed now)

Unchanged from v0.1, expanded in Section 16.

---

## 3. Recommended Technology Stack

### Proposed: Tauri + React + TypeScript + Rust

**Evaluation, not a default acceptance:**

| Technology | Why it fits | Alternative considered | Tradeoff |
|---|---|---|---|
| **Tauri** (target: Tauri 2.x) | Small binary size, low memory footprint (important on old lab machines), uses the OS-native webview instead of bundling Chromium, first-class Rust backend for process/filesystem access | Electron | Electron is heavier (bundles Chromium per app, hundreds of MB, higher RAM use) — a real concern on aging lab PCs. Tauri's Linux webview story (WebKitGTK) is less mature than Chromium but adequate for an editor UI. |
| **React + TypeScript** (React 18.x, TypeScript 5.x) | Mature ecosystem, large pool of editor components (Monaco, CodeMirror), TypeScript catches bugs early in a small team without dedicated QA infra | Vue, Svelte | React has more boilerplate than Svelte, but the ecosystem maturity (terminal, editor libraries) matters more here than raw performance. |
| **Rust (Tauri core)**, stable channel | Required by Tauri; also a good fit for spawning/managing child processes (compilers, interpreters, shells) safely and efficiently | Tauri with a Node.js sidecar | A sidecar adds a second runtime dependency for no real benefit here; native Rust process handling is simpler and lighter. |

**Verdict:** The stack is appropriate for CodeUI. It is not over-engineered for this problem: no framework is being adopted "because it's popular" — each piece has a specific job (lightweight shell, familiar UI layer, safe process control). The main risk is Linux webview maturity/quirks (see Open Decisions).

### 3.1 Build & Tooling Language Policy (expanded detail — no Python anywhere in development)

This subsection makes explicit something the v0.1 stack already implied but never stated directly, and which must be treated as a hard constraint for anyone (human or AI) implementing this plan:

**Rule: Python is never used to build, script, test, generate code for, or automate any part of CodeUI's own development.** Concretely:

| Task | Language used | Rationale |
|---|---|---|
| Application backend logic (fs, process, PTY, IPC commands) | **Rust** | Already the Tauri core language; no reason to introduce a second backend language |
| Application frontend (UI, editor wrapper, terminal wrapper) | **TypeScript** (React) | Already the chosen frontend stack |
| Unit tests for frontend logic (path handling, reducers, hooks) | **TypeScript**, via **Vitest** | Vitest is the natural test runner for a Vite/React + TypeScript codebase; no Python test runner is introduced |
| Unit tests for Rust command functions | **Rust**, via `cargo test` | Standard, built into the toolchain already required for Tauri |
| One-off build/dev-workflow scripts (e.g. "generate icons," "bump version across files," "check for missing translations") | **Rust `xtask` pattern** (a plain Cargo binary crate, e.g. `xtask/src/main.rs`, run via `cargo run -p xtask -- <task>`) **or** a small **Node.js/TypeScript script** run via `tsx`/`ts-node`, whichever is closer to the file being touched (Rust-side scripts as `xtask`, frontend-side scripts as Node) | Keeps every build script in a language already required by the project, runnable with zero extra interpreter install, and reviewable by whoever owns that half of the codebase |
| Packaging scripts (AppImage/`.deb` assembly, see Section 13) | **Tauri's built-in Rust-based bundler**, supplemented only by plain **POSIX shell (`bash`)** one-liners where the bundler needs a pre/post hook | Tauri's bundler is already Rust; shell is the lowest-ceremony option for "run `strip` on the binary" style hooks and needs no interpreter beyond what Ubuntu ships |
| CI pipeline definition (GitHub Actions) | **YAML** workflow files invoking the Rust/Node toolchains above | CI YAML is configuration, not a programming language choice, but it's listed here for completeness — no step in the pipeline shells out to `python3` |

**What Python is, and only is, in this project:** one of four **execution targets** CodeUI's Language Runners module knows how to invoke on a student's behalf (Section 6). CodeUI spawns `python3` as a *child process* the exact same way it spawns `gcc` or `java` — it does not import Python, embed a Python interpreter, or use Python for any part of its own logic. A developer or AI implementing this project should never reach for a `.py` file for any task described in this plan; if a task feels like "this would be a quick Python script," the correct move under this policy is a `tsx` script or an `xtask` Rust binary instead, per the table above.

This is also why Section 12's *runtime* dependency list still includes Python 3 — that entry describes what needs to be installed on a **lab machine** so students' Python programs run, which is unrelated to what a **developer's machine** needs to build CodeUI (also listed in Section 12, and notably Python-free).

---

## 4. High-Level Architecture

```
        React + TypeScript UI (editor, explorer, terminal view, settings)
                          │  (Tauri IPC — invoke/emit)
                          ▼
              Tauri Core (Rust) — commands & event bridge
                          │
       ┌──────────────────┼──────────────────┐
       ▼                  ▼                  ▼
  Filesystem access   Process spawning    Environment
  (read/write/list)   (compilers, PTY)    detection
       │                  │                  │
       └──────────────────┼──────────────────┘
                          ▼
                    Linux (Ubuntu)
                          │
          GCC / G++ / Python3 / JDK / Shell / Browser
```

The diagram above is the original v0.1 sketch, preserved for continuity. The expanded version below names every concrete Tauri command referenced elsewhere in this plan, and separates the frontend panels so each can be traced to its owning module in Section 5.

![High-level architecture](images/architecture_overview.png)

**Communication rule (unchanged, expanded):** The frontend never touches the filesystem or spawns processes directly. All of that goes through explicit, narrow Rust `#[tauri::command]` functions (e.g. `read_file`, `write_file`, `run_program`, `detect_tools`). This keeps a single, auditable boundary between "UI" and "system access" — important given students will be running arbitrary code on lab machines. In practice this means:

- Every frontend action that touches the OS goes through exactly one `services/` wrapper function (Section 9), which calls exactly one named Tauri command — never a generic "run arbitrary shell string" command with the actual command built up in the frontend. This makes every possible OS interaction enumerable by reading `src-tauri/src/commands/` alone, without reading any frontend code.
- Commands are narrow and single-purpose (`read_file(path)`, not `fs_operation(op, args)`), so a code reviewer can reason about exactly what each one can do without tracing call sites.
- Streaming data (process stdout, PTY output) flows back via Tauri's event system (`emit`/`listen`), not as a giant return value from `invoke`, so long-running programs display output incrementally (Section 6).

---

## 5. Major Modules

| Module | Responsibility | Key interfaces / notes |
|---|---|---|
| **Application Shell** | Window lifecycle, top-level layout (explorer + editor + terminal panels), menu/keyboard shortcuts | Owns the resizable panel layout (explorer left, editor center, terminal bottom — standard IDE arrangement); owns global keyboard shortcuts (Ctrl+S save, Ctrl+F find, Ctrl+`` ` `` focus terminal) |
| **Code Editor** | Text editing surface (Monaco or CodeMirror), syntax highlighting per language, tabs, find/replace — with built-in suggestion/autocomplete features explicitly disabled | **Must explicitly disable**, at initialization, every suggestion-related feature the underlying library ships with by default: Monaco's `quickSuggestions`, `suggestOnTriggerCharacters`, `parameterHints`, `wordBasedSuggestions`, `inlineSuggest`, and any "AI" extension surface; CodeMirror's autocomplete extension must simply never be added to the extension list. This is a startup-time configuration concern, not a feature to build — but it is the single most safety-critical configuration line in the whole app and must be covered by an explicit automated check (Section 11) |
| **File Explorer** | Directory tree view, file/folder create/rename/delete, open-in-tab | Reads directory contents via the `fs` commands only; never uses a Node.js `fs` module directly in the frontend (there isn't one available in the Tauri webview context by design) |
| **Tab Manager** | Tracks open files, dirty/unsaved state, switching, close-with-confirmation | Dirty state is derived from "current editor buffer content ≠ last-saved content," not from a naive "has the user typed anything" flag, so undo-to-saved-state correctly clears the dirty indicator |
| **Terminal** | Embedded shell session (see Section 7) | One PTY session per terminal panel instance; multiple terminal panels are allowed to exist concurrently (e.g. one for running a program, one for `git` or `ls`), each independently lifecycled |
| **Code Execution/Compilation Engine** | Orchestrates: pick language runner → compile if needed → run → capture output/exit code → report back to UI | This is the module that owns the timeout timer and the Stop control's kill signal (Section 6); it does not itself know how to invoke any specific compiler — that's delegated to Language Runners |
| **Language Runners** | One implementation per language (C, C++, Python, Java) behind a common interface: `compile()` (optional) + `run()` | Each runner is a small, independently testable Rust module (`c.rs`, `cpp.rs`, `python.rs`, `java.rs`) implementing the same trait, so adding a future language (explicitly out of scope for v0.1, Section 16) means implementing one new file against an existing interface, not touching the orchestration logic |
| **Web Preview** | Renders HTML/CSS/JS in a preview pane (embedded webview or system browser) | v0.1 preview is a manual "Preview" action re-reading the saved file (see Open Decision on live-reload feasibility) rather than a filesystem-watcher-driven auto-refresh, to keep the dependency surface small |
| **Environment Detection** | Checks for gcc/g++/python3/java/javac/browser on startup and on demand; surfaces clear "tool not found" messaging | Runs each check as `which <tool>` (or the Rust equivalent, resolving `$PATH` directly) rather than attempting to invoke the tool with a version flag, so a broken-but-present tool doesn't get misreported as "missing" |
| **Settings** | Small set of editor/app preferences (font size, theme, tab width, default shell) — no configuration complexity beyond this | Persisted as a single JSON file under the user's config directory (`~/.config/codeui/settings.json` on Linux); loaded once at startup, written on change with a short debounce |
| **Error Handling** | Consistent surfacing of compiler errors, runtime crashes, missing-tool errors, and internal app errors to the user in a readable form | Every error surfaced to the student carries three things: a plain-language summary, the raw tool output (stderr) for anyone who wants it, and a category tag (`compile-error` / `runtime-error` / `missing-tool` / `internal-error`) so the UI can style/route each consistently |

No module is included "because IDEs usually have it" — each one maps directly to a Section 1 requirement.

![Module dependency map](images/module_dependencies.png)

---

## 6. Language Execution Design

General pipeline per language: **Source → (compile if needed) → Execute → Capture stdout/stderr/exit code → Display**

| Language | Pipeline | Exact invocation (developer reference) |
|---|---|---|
| C | Source → `gcc` → executable → run → output | `gcc -Wall -g -o <tmp_binary> <source.c>`, then execute `<tmp_binary>` |
| C++ | Source → `g++` → executable → run → output | `g++ -Wall -g -std=c++17 -o <tmp_binary> <source.cpp>`, then execute `<tmp_binary>` |
| Python | Source → `python3` interpreter → output (no separate compile step) | `python3 -u <source.py>` (the `-u` flag disables stdout buffering so streamed output — Section 6's incremental-display requirement — actually arrives incrementally instead of being held in a buffer until the process exits) |
| Java | Source → `javac` → `.class` → `java` → output | `javac <Source.java>` in a scratch directory, then `java -cp <scratch_dir> <ClassName>` (class name parsed from the `public class` declaration, not assumed to match the filename stem, though in practice they must match for `javac` to succeed) |
| Web | HTML/CSS/JS → rendered in preview pane (no compile step) | No process spawned; the preview pane loads the saved file directly |

The flags above are defaults, not hard-coded constants invisible to the student — `-std=c++17` in particular is a decision worth surfacing in Settings if lab curricula assume a different standard (flagged as a candidate Settings addition, not committed for v0.1).

![Execution pipeline flowchart](images/execution_pipeline_flowchart.png)

**Process handling details (expanded):**
- Each run happens in a child process spawned by the Rust core (`std::process::Command` or an async equivalent such as `tokio::process::Command`), never on the UI thread.
- **stdout/stderr** are streamed back to the UI incrementally (not buffered until exit), so long-running programs show output as it happens. Concretely: the Rust side reads from the child's stdout/stderr pipes in a loop (or via `tokio::io::AsyncReadExt`) and `emit`s a `process-output` event per chunk read, rather than calling `.wait_with_output()` and returning everything at once.
- **Exit codes** are captured and shown to the student (e.g. "Process exited with code 139 — likely a segmentation fault"). The mapping from common exit codes/signals to a plain-language hint is a small static lookup table (Section 6.1 below), not a generic "exited with code N."
- **Compilation errors** (gcc/g++/javac) are captured from stderr and shown distinctly from runtime errors — visually (different panel styling/color) and semantically (tagged `compile-error`, per the Error Handling module in Section 5).
- **Runtime errors/crashes** are reported with whatever signal/exit code information is available, using the same lookup table.
- **Timeouts:** every run gets a configurable wall-clock timeout (default 10–15 seconds) after which the process is forcibly terminated and the student is told the program was killed for running too long. Implementation detail: the timeout is enforced by spawning the child inside its own process group (`setsid`/`setpgid` on Linux) so that terminating "the program" also terminates anything it forked, and escalates from `SIGTERM` to `SIGKILL` after a short grace period (e.g. 500ms) if the process hasn't exited. This is a basic safeguard against infinite loops, not a scheduling/priority solution (see Section 8).
- **Manual termination:** a "Stop" control in the UI must be able to kill the running process (and its children, where applicable) on demand, using the same process-group kill path as the timeout above so there is only one termination code path to test, not two.
- **Interactive input (stdin):** programs that call `scanf`/`input()`/`Scanner` need a way to receive typed input from the integrated terminal — this only works cleanly if execution is routed through the terminal's PTY rather than a plain captured subprocess (see Open Decisions, and Section 7).

### 6.1 Exit code / signal interpretation table (new implementation detail, not new scope)

This table operationalizes the "capture exit codes... report back" line from v0.1 into something a developer can directly implement as a lookup:

| Exit code / signal | Plain-language hint shown to student |
|---|---|
| `0` | "Program finished successfully." |
| Non-zero, no signal (e.g. `1`, `2`) | "Program exited with code N." (generic — most languages use small nonzero codes for their own reasons; no further guessing) |
| `139` (128 + SIGSEGV) | "Program crashed — likely a segmentation fault (invalid memory access)." |
| `134` (128 + SIGABRT) | "Program crashed — abort signal (often a failed assertion or a corrupted allocator state)." |
| `136` (128 + SIGFPE) | "Program crashed — floating point exception (often integer division by zero)." |
| `137` (128 + SIGKILL) | "Program was terminated" (paired with the specific reason: timeout vs. manual Stop, from Section 6's tracked termination cause) |
| Uncaught language-level exception (Python traceback, Java stack trace) | Shown verbatim below the hint — CodeUI does not attempt to parse or summarize language-level exception text, only OS-level exit codes/signals |

---

## 7. Terminal Architecture

An integrated terminal inside a Tauri app needs a **real PTY (pseudo-terminal)**, not just a captured subprocess, if it's meant to behave like a normal shell (job control, interactive programs, `Ctrl+C`, etc.).

**Design (expanded):**
- Rust side: use a PTY library (`portable-pty`, the de facto standard Rust PTY crate, chosen specifically because it works uniformly enough across Unix PTY quirks that the rest of the app doesn't need Linux-specific PTY code beyond what `portable-pty` already handles) to spawn the user's default shell (`$SHELL`, falling back to `bash` if `$SHELL` is unset or invalid) attached to a pseudo-terminal.
- Frontend side: `xterm.js` renders the terminal UI and forwards keystrokes to the Rust side over Tauri IPC; PTY output is streamed back and written to the terminal.
- **Resizing:** terminal resize events from `xterm.js` (`onResize`) must be forwarded to the PTY (`resize()`) so full-screen programs (e.g. `vim`, `top`) render correctly — otherwise this is a common source of garbled output. Concretely, `xterm.js`'s `FitAddon` computes `{cols, rows}` from the panel's pixel dimensions, and every change is forwarded via `invoke("pty_resize", {cols, rows})`, which calls `portable-pty`'s `resize()` to issue the underlying `TIOCSWINSZ` ioctl on the PTY.
- **Lifecycle:** one PTY session per terminal panel; closing a tab/panel should terminate its shell process and any children.
- **Termination:** killing a terminal must also kill any process tree it spawned (avoid orphaned processes on the lab machine) — implemented via the same process-group kill path described in Section 6, applied to the PTY's child process group.
- **Linux shell compatibility:** target `bash` as the baseline; avoid assuming a specific shell's features in any CodeUI-injected commands (CodeUI itself injects no commands into the terminal beyond, optionally, an initial `cd` into the open project directory when a terminal panel is first created).

![Terminal PTY interaction sequence](images/terminal_pty_sequence.png)

Using the terminal itself (rather than a separate hidden subprocess) to run student programs is the simplest way to naturally support interactive stdin — this is called out as an Open Decision below since it affects how Section 6's Run/Compile engine integrates with Section 7's terminal.

---

## 8. Security Considerations

Students will run arbitrary, sometimes buggy or malicious, code on shared lab machines. CodeUI v0.1 **cannot and should not claim to guarantee security or prevent cheating** — it can only apply reasonable application-level safeguards.

![Security threat model and division of responsibility](images/security_threat_model.png)

**Realistic risks, application-level safeguards, and residual owner — combined table (expands the three separate v0.1 lists into one traceable mapping):**

| Risk | Likelihood in a lab setting | Impact | v0.1 application-level mitigation | Residual owner if unmitigated |
|---|---|---|---|---|
| Infinite loops / excessive CPU usage | High (common student bug, not malice) | Medium — one machine slows down | Execution timeout (Section 6) + Stop control | — (fully addressed at app level for the common case) |
| Excessive memory allocation | Medium | Medium — one machine slows/swaps | None enforced at OS level in v0.1 | Ubuntu (no memory limit imposed by CodeUI) |
| Unintended filesystem manipulation (student code deletes/overwrites files) | Low–Medium | Medium — student's own project data | Confirmation prompts before destructive *editor-driven* file operations; autosave/unsaved-change warnings | Standard Linux file permissions for anything a student's *own compiled program* does directly to the filesystem |
| Uncontrolled process spawning (a program forking/launching other processes) | Low | Medium | Process-group-based timeout/Stop kill (Section 6) catches forked children too, as long as they stay in the same process group | Ubuntu, if a program deliberately detaches from its process group |
| Malicious/destructive shell commands typed into the integrated terminal | Low (requires intent) | High if it occurs | None — the terminal is, by design, a real shell with the student's real permissions | Lab administrator (machine lockdown, disk imaging between sessions) |
| Network access from student programs | Medium (e.g. a Python script using `requests`) | Low–Medium depending on lab policy | None — v0.1 does not sandbox or restrict network access | Lab administrator (network policy) |
| Privilege escalation attempts | Low | High if successful | CodeUI never elevates privileges itself and runs entirely as the student's own OS user, so it introduces no *new* privilege-escalation surface beyond what the OS already exposes | Ubuntu's own privilege model |
| Accidental loss of unsaved work (crash, force-quit) | Medium | Low–Medium (student frustration, lost lab time) | Autosave / unsaved-changes warnings before destructive actions (close tab, quit app) | — |

**What v0.1 explicitly does NOT attempt (unchanged from v0.1, restated for completeness):**
- Sandboxing/containerizing student code execution (e.g. via containers, seccomp, or resource cgroups) — a real future hardening step, not a v0.1 commitment.
- Network isolation of student programs.
- Memory limits enforced at the OS level.
- Any guarantee against a student running arbitrary destructive commands in the integrated terminal — the terminal is, by design, a real shell.

**Division of responsibility (unchanged, now cross-referenced against the table above):**
- **Application-level (CodeUI's job):** timeouts, process termination, confirmation dialogs, no privilege elevation.
- **Operating-system-level (Ubuntu's job):** user account permissions, standard filesystem ACLs, whatever restrictions the lab OS image already applies.
- **Lab administrator's job:** machine-level lockdown (user account restrictions, disk imaging/reset between sessions, network policy) — CodeUI is a tool running inside whatever security boundary the lab already has, not a replacement for it.

This should be stated plainly to any instructor evaluating CodeUI: it improves the *editing and execution experience* without providing suggestions; it does not turn a lab PC into a secure sandbox.

---

## 9. Project Structure

```
codeui/
├── src/                          # React + TypeScript frontend
│   ├── components/
│   │   ├── editor/               # Editor wrapper, tab bar, find/replace UI
│   │   ├── explorer/             # File tree view
│   │   ├── terminal/             # xterm.js wrapper component
│   │   ├── settings/             # Settings panel
│   │   └── shell/                # App shell/layout, menu bar
│   ├── services/                 # Frontend-side wrappers around Tauri `invoke` calls
│   │   ├── fsService.ts          # read_file / write_file / list_dir / rename / delete
│   │   ├── processService.ts     # run_program / stop_program
│   │   ├── ptyService.ts         # spawn_pty / write_pty / resize_pty / kill_pty
│   │   ├── envService.ts         # detect_tools
│   │   └── settingsService.ts    # load_settings / save_settings
│   ├── hooks/                    # React hooks (e.g. useFile, useTerminalSession)
│   ├── types/                    # Shared TypeScript types (mirrors Rust command signatures)
│   └── App.tsx
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── commands/             # Tauri commands: fs.rs, process.rs, terminal.rs, env_detect.rs, settings.rs
│   │   ├── runners/               # Language runner implementations (c.rs, cpp.rs, python.rs, java.rs, runner_trait.rs)
│   │   ├── pty/                   # PTY session management
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── xtask/                         # Rust-based build/dev automation scripts (NOT Python — see Section 3.1)
│   └── src/main.rs
├── tests/
│   ├── frontend/                  # Vitest unit tests, mirroring src/
│   └── integration/                # Full round-trip tests against a real Ubuntu environment (Section 11)
├── docs/
│   ├── IMPLEMENTATION_PLAN.md      # This document
│   └── images/                     # Diagram sources and rendered assets
├── .github/workflows/               # CI pipeline definitions (YAML, invoking cargo/npm only)
└── README.md
```

`services/` matters here specifically because it keeps every "talk to the OS" call behind one typed layer in the frontend, rather than scattering raw `invoke("...")` calls through components. The 1:1 naming between `services/*Service.ts` files and `commands/*.rs` files (both expanded above) is intentional: anyone auditing "what can the frontend actually make the OS do" can read the five files in `commands/` and find the complete answer, cross-checked against the five matching service wrappers.

---

## 10. Development Phases

| Phase | Objective | Components | Depends on | Outcome | Testing |
|---|---|---|---|---|---|
| **0. Foundation** | Project skeleton runs | Tauri+React scaffold, repo/CI setup | — | App launches to a blank window on Ubuntu | Manual smoke test on target Ubuntu version |
| **1. Application Shell** | Basic layout in place | Window, panel layout, menu bar | Phase 0 | Explorer/editor/terminal panel regions visible (empty) | Manual UI check |
| **2. Editor** | Working text editor | Monaco/CodeMirror integration, tabs, syntax highlighting, find/replace, suggestions explicitly disabled | Phase 1 | Can open/edit/save a file with highlighting, no autocomplete | Unit tests on file open/save; manual + automated check that no suggestion UI can appear (Section 11) |
| **3. File Management** | Real project browsing | File explorer, create/rename/delete, Rust fs commands | Phase 2 | Can manage a project folder end-to-end | Integration tests on fs commands; permission-error cases |
| **4. Terminal** | Working integrated shell | PTY session, xterm.js wiring, resize, lifecycle | Phase 1 | Can run arbitrary shell commands inside CodeUI | Manual + scripted tests: resize, Ctrl+C, process cleanup on close |
| **5. C/C++ Execution** | Run/Compile for C & C++ | gcc/g++ runners, error/output capture, timeout | Phases 3–4 | Compile+run works; errors shown clearly | Valid program, syntax error, runtime crash, infinite loop |
| **6. Python Execution** | Run for Python | python3 runner | Phase 4 | Python scripts run with streamed output | Valid script, exception, infinite loop, stdin-reading script |
| **7. Java Execution** | Run/Compile for Java | javac + java runner | Phase 4 | Java compiles and runs | Compile error, runtime exception, class-not-found cases |
| **8. Web Development** | HTML/CSS/JS preview | Preview pane, live reload if feasible | Phase 3 | Can edit and preview a simple web page | Manual checks across a few sample pages |
| **9. Environment Detection** | Startup tool checks | Detection commands for all toolchains | Phases 5–8 | Missing-tool states are clearly reported, not silent failures | Simulate missing gcc/python/java on a test VM |
| **10. Settings & Polish** | Usable defaults | Font size, theme, tab width, shell path | Phases 2, 4 | Settings persist across restarts | Manual regression pass |
| **11. Testing Hardening** | Stability pass | Bug fixing from all prior phases | Phases 0–10 | No known crashes on core flows | Full manual test matrix (Section 11) |
| **12. Packaging** | Installable build | `.deb` and/or AppImage build pipeline | Phase 11 | Installs and runs on a clean Ubuntu machine | Clean-VM install/uninstall test |

Dependency order follows: shell → editor → files → terminal, then language runners (which all depend on the terminal/process layer), then polish and packaging last.

![Illustrative phase sequencing](images/development_phases_gantt.png)

*Reading the chart above:* the axis is labeled in relative weeks, not calendar dates — this plan does not commit to a fixed ship date. What the chart is meant to convey is the **shape** of the schedule: Phases 2 (Editor) and 4 (Terminal) can run in parallel since both depend only on Phase 1; Phases 5–8 (the four language runners plus web preview) can likewise be split across two developers once their shared dependencies (Phase 3 or Phase 4) land; Phases 11–12 are drawn as critical-path (marked in red) because nothing after them can be parallelized — hardening needs everything else finished, and packaging needs hardening finished.

### 10.1 Phase-by-phase sub-task breakdown (expanded detail, same phases as above)

This subsection exists to make each phase directly actionable without inventing new phases:

- **Phase 0 — Foundation:** initialize Tauri+React+TypeScript project scaffold; confirm `cargo tauri dev` launches a window on the target Ubuntu version; set up the repository (Section 14 branching model); set up CI to run `cargo check` and `npm run build` on every push; set up the `xtask` crate skeleton (Section 3.1) even if it does nothing yet, so the "no Python" tooling pattern exists from day one.
- **Phase 1 — Application Shell:** implement the three-panel resizable layout (explorer/editor/terminal); implement the menu bar and the keyboard-shortcut registry; wire window lifecycle events (close-with-unsaved-changes warning, stubbed until Phase 2's dirty-state exists).
- **Phase 2 — Editor:** integrate the chosen editor library (Section 3, Open Decision 3); explicitly disable every autocomplete/suggestion feature the library ships with (Section 5); implement tabs and the Tab Manager's dirty-state tracking; implement find/replace; implement file open/save wired to the `fs` commands.
- **Phase 3 — File Management:** implement the directory tree component; implement create/rename/delete with confirmation dialogs for delete; implement the Rust `fs` commands (`read_file`, `write_file`, `list_dir`, `rename`, `delete`) with explicit error types for "permission denied" and "path not found" so the frontend can show a specific message rather than a generic failure.
- **Phase 4 — Terminal:** integrate `xterm.js` and `portable-pty`; implement the PTY spawn/write/resize/kill commands; wire the resize-forwarding path (Section 7); verify `Ctrl+C` correctly interrupts a running foreground program in the PTY.
- **Phase 5 — C/C++ Execution:** implement the `c.rs` and `cpp.rs` runners against the shared runner trait; wire the timeout + process-group-kill path (Section 6); implement the exit-code/signal lookup table (Section 6.1); verify streamed stdout appears incrementally, not all at once on exit.
- **Phase 6 — Python Execution:** implement `python.rs`; confirm the `-u` unbuffered flag is applied (Section 6) so streaming actually works for Python specifically, since Python buffers stdout by default when not attached to a real TTY.
- **Phase 7 — Java Execution:** implement `java.rs`; handle the two-step compile-then-run invocation; handle the class-name-vs-filename constraint in error messaging if `javac` rejects a mismatch.
- **Phase 8 — Web Development:** implement the preview pane (embedded webview view or a call out to the system browser, per Open Decision 2's webview-maturity finding); implement the manual "Preview" refresh action.
- **Phase 9 — Environment Detection:** implement `detect_tools`, checking `gcc`, `g++`, `python3`, `javac`, `java`, and a usable browser via `$PATH` resolution; implement the startup banner/dialog that lists any missing tool by name.
- **Phase 10 — Settings & Polish:** implement the settings JSON persistence (Section 5); implement the settings panel UI; sweep all prior phases for rough edges found during their own manual checks.
- **Phase 11 — Testing Hardening:** execute the full test matrix in Section 11 end-to-end at least once; fix everything it surfaces; re-run.
- **Phase 12 — Packaging:** produce an AppImage via Tauri's bundler (Section 13); produce a `.deb` if time allows; validate both on a machine that is not a developer's own.

---

## 11. Testing Strategy

- **Unit testing:** Rust command functions (fs operations, runner argument construction) tested in isolation via `cargo test`; frontend utility functions (path handling, state reducers) tested with **Vitest** (a JS/TS test runner — not a Python one, consistent with Section 3.1).
- **Integration testing:** full round-trip flows — "create file → write code → run → see output" — exercised against a real Ubuntu environment with the actual toolchains installed.
- **UI testing where appropriate:** critical interaction paths (open file, switch tabs, run program, resize terminal) covered by component/interaction tests; full end-to-end UI automation is a stretch goal, not a v0.1 requirement given team size. Where end-to-end UI automation is attempted, **Playwright** (already Node-based) is the natural choice given the rest of the stack, rather than a Python-based browser automation tool.
- **Linux testing:** primary validation target is a real (or VM) Ubuntu LTS install matching what the college lab would realistically run.
- **Compiler/runtime testing:** explicit test matrix per language (valid program, syntax error, runtime crash, infinite loop, missing toolchain).
- **Suggestion-feature regression check (new detail, not new scope — this operationalizes the Section 5 Code Editor safety requirement):** because "no autocomplete, ever" is the single most important behavioral guarantee in this whole project, it should not rely on manual eyeballing alone by Phase 11. A lightweight automated check — a component test that types a trigger sequence known to summon suggestions in the underlying editor library's default configuration (e.g. `.` after an identifier in Monaco) and asserts no suggestion widget is present in the DOM — should be added in Phase 2 and re-run in every subsequent phase's CI, not deferred to the final hardening pass.

**Required failure/edge cases to cover (unchanged from v0.1):**
- Compiler/interpreter missing entirely
- Invalid/unparseable code
- Runtime crash (segfault, exception, non-zero exit)
- Infinite loop (timeout must trigger and process must actually die)
- Program waiting for input (stdin) that never receives it
- File permission errors (read-only file, no write access to folder)
- Missing/deleted project directory while open
- Very large files (editor should not hang)
- Many tabs open simultaneously
- Terminal process termination (closing a tab/panel doesn't leave orphaned processes)

### 11.1 Test matrix expanded to explicit pass/fail conditions (same cases as above, made concrete)

| Edge case | How it's triggered in testing | Pass condition |
|---|---|---|
| Compiler/interpreter missing entirely | Run on a VM/container with `gcc` uninstalled | CodeUI shows a "gcc not found" message, not a crash or a silent no-op |
| Invalid/unparseable code | Compile a `.c` file with a deliberate syntax error | Compiler stderr shown in full, tagged `compile-error`, no attempt to run a nonexistent binary |
| Runtime crash | Run a C program that dereferences a null pointer | Exit code 139 shown with the segfault hint from Section 6.1 |
| Infinite loop | Run `while(1){}` | Process is forcibly killed at the configured timeout; UI shows the timeout message; no leftover process in `ps` after the test |
| Program waiting for stdin that never receives it | Run a `scanf` program and don't type anything | Program visibly blocks in the terminal (not misreported as hung/crashed) until Stop is pressed or the timeout elapses |
| File permission errors | Attempt to save into a read-only directory | A specific "permission denied" message, not a generic save failure |
| Missing/deleted project directory while open | Delete the open folder from another terminal while CodeUI has it open | CodeUI detects the missing path on next access and reports it, rather than repeatedly failing silently |
| Very large files | Open a multi-MB text file | Editor remains responsive (scrolling, typing) — exact size threshold to be determined by a Phase 2 spike against the chosen editor library |
| Many tabs open simultaneously | Open 30+ files | No visible memory/performance cliff; tab bar remains usable (scrolling/overflow behavior defined) |
| Terminal process termination | Close a terminal panel mid-command | No orphaned process for that panel's shell or its children afterward, verified via `ps --ppid` |

---

## 12. Ubuntu Environment Requirements

**Development dependencies (developer machines) — expanded with why each is needed:**
- **Rust toolchain (stable) + Cargo** — builds the Tauri core and the `xtask` automation crate (Section 3.1); no Python interpreter is required on a developer machine for any build step.
- **Node.js + a package manager (npm/pnpm)** — builds the React frontend and runs Vitest/Playwright/`tsx` tooling scripts.
- **Tauri CLI and its Linux system dependencies** (WebKitGTK, `build-essential`, `libssl-dev`, etc. per Tauri's official Linux prerequisites) — required to compile and run the app locally.
- **Git** — version control (Section 14).

**Runtime dependencies (lab machines, for full functionality) — expanded with the exact check each maps to in Environment Detection:**
- **GCC, G++** (for C/C++ execution) — checked by `detect_tools` via `which gcc` / `which g++`.
- **Python 3** (for Python execution — an execution target only, per Section 3.1, never a build dependency) — checked via `which python3`.
- **JDK** (`javac` + `java`) (for Java execution) — checked via `which javac` and `which java` separately, since a JRE-only install would have `java` but not `javac`, and CodeUI needs both.
- **A system browser or embeddable webview** (for web preview) — checked via presence of a known browser binary (`firefox`, `chromium`, etc.) as a fallback if the embedded webview path (Open Decision 2) proves insufficient for preview purposes.
- **A POSIX shell (`bash`)** (for the integrated terminal) — checked via `$SHELL` resolution with a `bash` fallback per Section 7.

Environment Detection (Module, Section 5) is what turns "toolchain missing" from a silent failure into a clear message — this should be treated as a core feature, not an afterthought, since lab machines will vary.

---

## 13. Packaging and Distribution

Two realistic Linux packaging options for v0.1:

- **AppImage:** single portable file, no installation/root required, runs on most distros without modification — good fit for "copy to lab machines and run" without needing package-manager access. Produced via Tauri's built-in bundler (`cargo tauri build --bundles appimage`), which is Rust-driven end to end — no Python packaging tool (e.g. no `pyinstaller`-style step) enters the pipeline.
- **`.deb`:** proper Ubuntu/Debian package, integrates with the system package manager, better for a lab that wants CodeUI formally installed and updated via `apt`. Produced via the same Tauri bundler (`cargo tauri build --bundles deb`).

**Recommendation for v0.1:** prioritize **AppImage** first — it minimizes friction for testing on lab machines that may not allow easy package installation, and it's the simpler of the two to produce with Tauri's bundler. Add `.deb` packaging once the app is stable, since colleges may prefer a "properly installed" application for wider deployment.

**Packaging checklist (new operational detail, not new scope):**
1. Bump version in `src-tauri/tauri.conf.json` and `package.json` together (candidate for an `xtask` script, per Section 3.1, rather than a manual two-file edit).
2. Run the full Section 11 test matrix on a clean checkout.
3. `cargo tauri build --bundles appimage` (and `deb` if applicable).
4. Copy the resulting artifact to a machine that has never had CodeUI or its dev dependencies installed.
5. Confirm first-launch behavior: Environment Detection correctly reports the state of that machine's toolchains, whatever they are.
6. Confirm settings persistence works on that machine's actual `$HOME`.

---

## 14. Git/GitHub Development Workflow

**Team:** Ritesh (product owner + lead developer), Ritesh's brother (developer + QA/testing), AI tools (Claude/ChatGPT/other) as development assistants.

- **Branching:** `main` (always stable/working), `dev` (integration branch), short-lived feature branches per phase/module (e.g. `feature/terminal-pty`, `feature/java-runner`).
- **Commits:** Conventional Commits style (`feat:`, `fix:`, `chore:`, `test:`, `docs:`) to keep history scannable with a 2-person team. Example applied to this project specifically: `feat(runner): add java compile+run pipeline`, `fix(pty): forward resize events on panel maximize`, `docs(plan): expand section 6 exit-code table`.
- **Pull requests:** every feature branch merges into `dev` via a PR, even solo — this creates a natural point to re-read AI-generated code before it lands.
- **Code review:** with only two people, review can be informal (the other person reads the diff before merge) but should not be skipped for anything touching process execution or the terminal (the highest-risk areas). A short, concrete review checklist for exactly those high-risk PRs: (1) does every spawned child process go through the process-group timeout/kill path, (2) does every new Tauri command validate its path/argument inputs before touching the filesystem or spawning anything, (3) does the diff introduce any Python file anywhere in the repository (it should not, per Section 3.1) — a one-line `git diff --name-only | grep '\.py$'` check is enough to catch this mechanically before it becomes a review-time debate.
- **Issue tracking:** use GitHub Issues per module/bug, tagged by phase (e.g. `phase-5`, `bug`, `security`).
- **Milestones:** one GitHub Milestone per development phase (Section 10), closed when that phase's testing requirements pass.

This is intentionally lightweight — the goal is just enough process to keep two people and AI-generated code in sync, not enterprise process overhead.

---

## 15. Definition of Done for v0.1

CodeUI v0.1 is complete when, on a clean Ubuntu install with the runtime dependencies present:

1. A student can create/open/edit/save files with syntax highlighting, tabs, and find/replace — with no autocomplete or suggestions appearing anywhere (verified by the automated check from Section 11, not manual inspection alone).
2. A student can browse, create, rename, and delete files/folders via the file explorer.
3. A student can open and use an integrated terminal without launching a separate terminal application, including running interactive programs that read stdin.
4. A student can write and run C, C++, Python, and Java programs, seeing compiler errors, runtime output, and runtime errors clearly (using the plain-language exit-code hints from Section 6.1), with runaway programs stoppable (via timeout or manual Stop).
5. A student can write basic HTML/CSS/JS and preview it locally.
6. On startup, CodeUI clearly reports any missing required toolchain (gcc, g++, python3, java/javac, browser) rather than failing silently.
7. Basic settings (font size, theme, tab width, shell) persist across restarts.
8. The application is packaged as an installable AppImage (and ideally a `.deb`) and has been installed and used successfully on a machine other than a developer's own, following the Section 13 packaging checklist.
9. The full test matrix in Section 11 (including the 11.1 pass/fail table) has been run at least once with no unresolved crashes on core flows.
10. **No file in the repository is a Python script used for building, testing, or packaging CodeUI** (Section 3.1) — `python3` appears only as a runtime dependency name in Section 12 and as a string literal inside the Python language runner's invocation code.

Nothing beyond this list is required for v0.1, and nothing on the "explicitly excluded" list (Section 2) should be present.

---

## 16. Future Possibilities (v0.2+, not committed)

- Windows support — would require re-evaluating the Tauri/WebKitGTK-specific assumptions in Section 3 and Open Decision 2 against Windows' WebView2, and re-validating the PTY layer (`portable-pty` supports Windows conpty, but the shell-fallback logic in Section 7 is currently written Linux-first).
- Centralized/institutional configuration or deployment tooling for a whole lab — would sit on top of the existing Settings module (Section 5) rather than replacing it, most likely as an import/export of the same JSON settings file across machines.
- Additional language support beyond C, C++, Python, Java, Web — the Language Runners' shared trait interface (Section 5, Section 9) is specifically designed so this would mean adding one new file, not restructuring the Execution Engine.
- More advanced project/workspace management — e.g. multi-root workspaces, which the current single-folder-open model (Section 5, File Explorer) does not support.
- Cloud components (only if a genuine institutional need emerges post-v0.1) — explicitly not designed against in the current architecture (Section 4), which assumes a fully local, single-user process.

These are directions to keep in mind, not designs to build toward now — including any of them prematurely risks the scope creep this plan is explicitly trying to avoid.

---

## Open Decisions

These require further investigation/discussion before or during implementation — they are flagged rather than silently resolved. Each now includes a recommended default and how to validate it, without treating the decision as closed:

1. **Run vs. Terminal integration for student programs.** Should "Run" execute in a hidden subprocess (simpler, but awkward for programs needing stdin) or inside the same PTY-backed terminal (more natural interactive behavior, but couples the execution engine to the terminal module more tightly)? This affects both Section 6 and Section 7's design.
   - *Recommended default:* route Run through the terminal's PTY (Section 7's "using the terminal itself" note) for all languages uniformly, so there is one execution path to test instead of two, and interactive stdin (a required v0.1 capability per Section 2) works automatically rather than as a special case.
   - *How to validate:* a Phase 4/5 spike that runs a `scanf`-based C program both ways and compares output-streaming latency and terminal-state cleanliness (does the prompt reappear correctly after the program exits).

2. **Tauri + WebKitGTK maturity on target lab distros.** The exact Ubuntu version(s) used in the college's labs should be confirmed early, and a spike/prototype should validate that Tauri's Linux webview renders the editor UI (Monaco/CodeMirror) acceptably on that specific environment before committing further.
   - *Recommended default:* target the most recent Ubuntu LTS at project start (validate the exact version against the actual lab image before Phase 0 exits).
   - *How to validate:* Phase 0's smoke test should run on an actual image of the lab's Ubuntu version, not just a developer's own machine.

3. **Editor library choice: Monaco vs. CodeMirror.** Monaco (VS Code's editor) is heavier but very capable and easy to strip suggestions from; CodeMirror is lighter but may need more manual setup for some languages. Needs a short spike to compare bundle size/performance on representative lab hardware.
   - *Recommended default:* Monaco, specifically because "easy to strip suggestions from" (i.e., every suggestion feature is a single documented config flag, Section 5) is a safety property, not just a convenience, given how central "never suggest" is to this project.
   - *How to validate:* the Phase 2 spike should measure both bundle size and cold-start time on the lowest-spec representative lab machine identified by Open Decision 6, since Monaco's heavier footprint is the actual tradeoff being accepted.

4. **Execution timeout duration and process-tree termination.** The exact default timeout value, and how reliably a runaway program's child processes are killed on Linux (process groups vs. individual PID kill), needs to be prototyped and tested rather than assumed.
   - *Recommended default:* 12 seconds as the out-of-the-box timeout (mid-point of the "10-15 second" range already specified in Section 6), configurable in Settings; process-group kill (Section 6) rather than single-PID kill, specifically because it also covers forked children.
   - *How to validate:* the infinite-loop and fork-bomb-style test cases in Section 11.1, checked against `ps` output after termination.

5. **Java startup latency.** JVM startup time is nontrivial; whether this is acceptable for a lab "run and see output quickly" workflow should be validated with real timing on target hardware.
   - *Recommended default:* accept JVM startup latency as an inherent cost of supporting Java at all (there is no alternative Java execution path in scope), but surface a visible "compiling/starting..." state in the UI during the `javac`→`java` gap so it doesn't read as a hang.
   - *How to validate:* measure wall-clock time from Run click to first output on the target lab hardware during Phase 7.

6. **Minimum supported Ubuntu/lab hardware spec.** Since lab PCs are likely older/lower-spec, an early decision on the minimum supported hardware would help validate the Tauri choice concretely rather than in theory.
   - *Recommended default:* whatever the college's actual oldest in-service lab machine is — this is a fact to gather, not a number to guess, and it should be gathered before Phase 0 rather than assumed mid-project.
   - *How to validate:* run the Phase 0 smoke test and the Phase 2 editor spike on that specific hardware, not just a VM with arbitrarily capped resources.
