# CodeUI Audit Report 1: Problems, Bugs, and Architectural Deficiencies

**Audit Date:** October 2026  
**Target Repository:** `CodeUI` (`iamriteshhh/CodeUI`)  
**Scope:** Entire workspace (`d:\CodeUI` and `d:\CodeUI\CodeUI-main`), including Tauri/Rust backend, React/TypeScript frontend, build automation, CI/CD, installer packages, and repository hygiene.

---

## Executive Summary of Findings

A comprehensive review of every file, directory, configuration, and build artifact across the CodeUI codebase revealed critical defects that prevent the project from compiling, severe architectural disconnects in the core program execution engine, structural repository duplication, and security/hygiene concerns.

| Severity | Count | Primary Areas |
| :--- | :--- | :--- |
| **Critical (Blocker)** | 4 | Committed merge conflict markers, broken build pipelines, terminal/runner stdin disconnection, repository duplication |
| **High** | 5 | Windows executable path truncation in C/C++, sync Tauri command UI freezes, committed 30MB binaries, fake extension system, CI discovery failure |
| **Medium** | 6 | Atomic rename failures on Windows, fragile node_modules imports, hardcoded author paths, missing diagnostics panel, single-compiler lock-in |
| **Low / Cosmetic** | 4 | Inconsistent icon paths, missing license headers, unbundled fallback fonts, redundant installer directories |

---

## 1. Critical Breaking Defect: Active Git Merge Conflict Markers Across Codebase

In commit `dbc0c19` (merge of `604527e` and `66b6de4`), merge conflicts were accidentally committed directly into the codebase without resolution. As a result:
- **Rust backend (`cargo check`, `cargo build`, `cargo test`) fails to compile immediately.**
- **Frontend TypeScript (`tsc --noEmit`, `npm test`, `vite build`) fails with syntax errors.**
- **`package-lock.json` contains invalid JSON syntax.**

### Specific Conflicted Files & Line Numbers:

1. **`CodeUI-main/src-tauri/src/commands/env_detect.rs` (Lines 111–120):**
   ```rust
   <<<<<<< HEAD:CodeUI-main/src-tauri/src/commands/env_detect.rs
               let path = crate::proc::resolve_tool(spec.candidates)
                   .map(|p| p.to_string_lossy().into_owned());
   =======
               let path = spec.candidates.iter().find_map(|&cand| {
                   which::which(cand)
                       .ok()
                       .map(|p| p.to_string_lossy().into_owned())
               });
   >>>>>>> 66b6de40caf85349a094aaf1377b064cfc6d6bf6:src-tauri/src/commands/env_detect.rs
   ```
   *Impact:* Compiler stops with `error: encountered diff marker`. The HEAD branch logic using `crate::proc::resolve_tool` is necessary to respect augmented paths.

2. **`CodeUI-main/src-tauri/src/pty/mod.rs` (Lines 318–352):**
   ```rust
   <<<<<<< HEAD:CodeUI-main/src-tauri/src/pty/mod.rs
       }
       #[test]
       fn test_duplicate_session_id_is_rejected() { ... }
   =======
   >>>>>>> 66b6de40caf85349a094aaf1377b064cfc6d6bf6:src-tauri/src/pty/mod.rs
   ```
   *Impact:* Breaks PTY test suite compilation.

3. **`CodeUI-main/src/services/settingsService.ts` (Lines 20–24):**
   ```typescript
   <<<<<<< HEAD:CodeUI-main/src/services/settingsService.ts
     recentFolders: [],
   =======
     recentFolders: ["D:\\JAVA", "C:\\Users\\sahil\\CodeUI"],
   >>>>>>> 66b6de40caf85349a094aaf1377b064cfc6d6bf6:src/services/settingsService.ts
   ```
   *Impact:* Breaks TypeScript compilation; the incoming branch re-introduces the author's hardcoded paths.

4. **`CodeUI-main/src/services/editorService.ts` (Lines 53–79 and 193–235):**
   - Conflict 1: `getText`, `focusActive`, and `layout` methods.
   - Conflict 2: `setMarkers` and `clearMarkers` methods for compiler diagnostics.
   *Impact:* Breaks `editorService` completely; prevents `npm test` and causes `diagnostics.test.ts` to crash during Vite esbuild transform.

5. **`CodeUI-main/src/languages/registerAllLanguages.ts` (Lines 132–161 and 210–230):**
   - Conflict 1: `registerAllEagerLanguages` return signature and registration cache.
   - Conflict 2: Token provider registration tracking.
   *Impact:* Breaks language grammar initialization.

6. **`CodeUI-main/src/components/welcome/WelcomeView.tsx` (Lines 47–54 and 112–146):**
   - Conflict 1: Recent folder fallback (`recentFolders || []` vs hardcoded `["D:\\JAVA", "C:\\Users\\sahil\\CodeUI"]`).
   - Conflict 2: Empty recent list JSX markup.
   *Impact:* JSX syntax parse errors (`error TS1005: '</' expected`, `error TS1185: Merge conflict marker encountered`).

7. **`CodeUI-main/src/components/editor/monacoSafeDefaults.ts` (Lines 48–61):**
   - Conflict over hover config and font family (`CodeUI Mono` vs `Consolas`).
   *Impact:* Editor safe options export is unparseable.

8. **`CodeUI-main/package-lock.json` (Lines 2107–2119):**
   - Conflict over `magic-string` dependency.
   *Impact:* `npm ci` fails with `JSON parse error`.

---

## 2. Severe Architectural Disconnect: The Run Engine vs. Terminal Stdin Pipeline

CodeUI advertises **lab-safe supervised execution with process isolation, timeouts, and interactive terminal support**. However, deep analysis of `useWorkspaceStore.ts`, `processService.ts`, `terminal.rs`, and `TerminalPanel.tsx` reveals a fatal architectural mismatch:

### The Mechanism:
1. When the student clicks **Run** (`runActiveFile`), `processService.runFile` initiates a backend child process via `commands/process.rs` with piped stdin/stdout/stderr.
2. The frontend subscribes to `processService.onRunOutput(runId, ...)`.
3. In `useWorkspaceStore.ts` (lines 627–661), whenever output or status is received, the code executes:
   ```typescript
   ptyService.writePty(sessionId, chunk.chunk);
   ptyService.writePty(sessionId, `\r\n\x1b[36m[Compiling ${status.language}...]\x1b[0m\r\n`);
   ```
4. **The Flaw:** `ptyService.writePty` writes directly to the **slave STDIN** of the interactive shell session (PowerShell or Bash) running inside the PTY!
5. **Double Echo & Shell Corruption:**
   - PowerShell receives `[Compiling C++...]` and the student program's stdout as *keyboard input*.
   - PowerShell attempts to parse and execute this output as shell commands, triggering errors like `The term '[Compiling' is not recognized as the name of a cmdlet...`.
   - The shell prompt (`PS C:\...>`) gets printed over the output.
6. **Interactive Input (`scanf`, `cin`, `input()`) is Impossible:**
   - When student code asks for input (e.g. `scanf("%d", &x)` or `input()`), the running binary pauses, waiting for input on its own `ChildStdin` pipe.
   - The student types in `xterm.js`. `TerminalPanel.tsx` takes the keystrokes and routes them via `ptyService.writePty(sessionId, input)` into **PowerShell**, NOT to the student's process!
   - `writeRunStdin` and `closeRunStdin` in `processService.ts` and `commands/process.rs` are **dead code** — they are never invoked anywhere in the UI.
   - The student program waits on its pipe until the 12-second watchdog fires and forcefully kills it with `SIGKILL` or `taskkill`.
   - **Conclusion:** Any interactive program in C, C++, Java, Python, or Salivo hangs and fails.

---

## 3. Structural Duplication: Root Workspace vs. `CodeUI-main/`

The repository directory layout is corrupted by an accidental partial copy at the workspace root:

```
d:\CodeUI\
├── .git\
├── README.md               <-- Root copy
├── index.html              <-- Root copy
├── vite.config.ts          <-- Root copy
├── src\                    <-- Incomplete copy (missing assets, data, languages, types, utils)
├── src-tauri\              <-- Incomplete copy (only capabilities/ and icons/, NO Cargo.toml, NO src/)
├── installer\              <-- Root binary installers (17.7 MB)
├── installers\             <-- Root binary installers (13.8 MB)
└── CodeUI-main\            <-- THE ACTUAL WORKING CODEBASE
    ├── Cargo.toml
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── src\
    ├── src-tauri\
    ├── xtask\
    ├── docs\
    └── .github\
```

### Consequences:
1. **Broken Root Build:** A developer running `npm install` or `cargo build` in `d:\CodeUI` immediately fails because the root has neither `package.json` nor `Cargo.toml`.
2. **Desynchronization:** Edits made to files in `CodeUI-main/src` are not reflected in root `src/` (and vice-versa). Git tracks both trees simultaneously.
3. **Editor Confusion:** When an IDE or user searches for a file like `App.tsx` or `index.css`, two copies appear with divergent contents.

---

## 4. Inert CI/CD Workflows

The GitHub Actions workflows (`ci.yml` and `release.yml`) are located at:
`d:\CodeUI\CodeUI-main\.github\workflows\`

- **GitHub Actions Discovery Rule:** GitHub *only* executes workflows located in `.github/workflows/` at the **root** of the Git repository (`d:\CodeUI\.github\workflows\`).
- **Status:** Because no `.github/` folder exists at the repository root, **CI has never run from this repository layout**.
- **Underlying Failure if Moved:** If the `.github/` folder is moved to the root without fixing the directory structure, the workflow will fail immediately because `npm ci` and `cargo test --workspace` assume `package.json` and `Cargo.toml` are in the current working directory.

---

## 5. Repository Hygiene: Large Compiled Binaries Tracked in Git

Over **31.5 MB** of compiled installer binaries are tracked in Git:

- `installer/CodeUI_0.1.0_aarch64.dmg` (5.86 MB)
- `installer/CodeUI_0.1.0_amd64.deb` (5.34 MB)
- `installer/CodeUI_0.1.0_x64-setup.exe` (6.51 MB)
- `installers/CodeUI_0.1.0_x64-setup.exe` (6.51 MB)
- `installers/CodeUI_0.1.0_x64_en-US.msi` (7.29 MB)

### Problems:
- Git is designed for text diffs, not multi-megabyte binary blobs. Every version bump increases the clone size permanently.
- `installer/` and `installers/` contain duplicate, slightly different builds of `CodeUI_0.1.0_x64-setup.exe` without explanation or version hashes.
- Security risk: Binaries committed to Git without automated reproducible build hashes or signatures cannot be verified by lab network administrators.
- In `tauri.conf.json`, `webviewInstallMode` is set to `"embedBootstrapper"`. On offline lab machines without internet access, this bootstrapper fails if WebView2 is missing.

---

## 6. Runner Implementation Defects

### 6.1 Missing Executable Extension on Windows (C and C++)
In `runners/c.rs` (lines 16–37) and `runners/cpp.rs` (lines 16–38):
```rust
// compile():
let out = ctx.scratch.join(ctx.stem());
// passes -o <scratch>/<stem> to gcc

// execute():
let bin = ctx.scratch.join(ctx.stem());
Ok(CommandSpec::new(bin.to_string_lossy().into_owned(), vec![], ctx.workdir.clone()))
```
- On Windows, `gcc` and `g++` automatically append `.exe` to the output file (producing `<scratch>/<stem>.exe`).
- In `execute()`, `bin` is `<scratch>/<stem>` (without `.exe`).
- When Rust's `std::process::Command::new(bin)` is executed on Windows with a directory path, `CreateProcessW` will fail to locate the binary because the file extension is omitted.
- *Contrast:* `runners/salivo.rs` correctly appends `std::env::consts::EXE_SUFFIX`.

### 6.2 Hardcoded Tool Names & Inflexible Compilers
- The C/C++ runners strictly invoke `gcc` and `g++`. If an institution uses `clang`/`clang++` (standard on macOS and many Linux setups) or MSVC (`cl.exe`), CodeUI reports the compiler as missing even if a full C/C++ toolchain is present.
- The Python runner executes with `-u` (unbuffered), but on Windows systems where Python is installed via Microsoft Store, the 0-byte stub can cause hangs or store popups if not carefully bypassed.

---

## 7. Filesystem & Concurrency Hazards

### 7.1 Atomic Save Failure on Windows (`write_file`)
In `src-tauri/src/commands/fs.rs` (lines 70–98):
```rust
let tmp = parent.join(format!(".{name}.codeui-tmp"));
std::fs::write(&tmp, contents)?;
std::fs::rename(&tmp, &p)?;
```
- On Windows, `std::fs::rename` maps to `MoveFileExW`. If the target file already exists, it can fail with `AccessDenied` or `AlreadyExists` if another process, antivirus scanner, or indexing service holds a shared read handle.
- The error handler attempts `remove_file(&tmp)` but does not fall back to an atomic copy/replace or overwrite, causing occasional save failures.

### 7.2 Synchronous File Commands on Main Thread
In `src-tauri/src/commands/fs.rs`:
- Commands such as `read_file`, `write_file`, `list_dir`, and `create_file` are synchronous functions (not `async fn`).
- In Tauri 2, non-async commands execute synchronously on the IPC thread pool. If an operation blocks (e.g. scanning a network share or large directory in `list_dir`), the frontend can stutter.

---

## 8. Extension System Misrepresentation

In `src/components/extensions/` and `src/services/extensionService.ts`:
- The UI presents a full VS Code-like extensions marketplace connecting to Open VSX, featuring search, reviews, download counts, and "Install" buttons.
- **The Problem:** The "Install" button only toggles `installed: true` in React state. CodeUI has no extension host, no VSIX parser, no Language Server Protocol (LSP) client, and no capability to run third-party extensions.
- When a student or teacher clicks "Install" on Python, Docker, or Clangd, no actual functionality is added. This creates user confusion and false expectations.
- Only Salivo has built-in syntax rules and execution logic hardcoded into the editor.

---

## 9. Monaco Editor & Syntax Highlighting Fragility

In `src/languages/registerAllLanguages.ts`:
```typescript
import * as cppLang from "../../node_modules/monaco-editor/esm/vs/languages/definitions/cpp/cpp.js";
import * as pythonLang from "../../node_modules/monaco-editor/esm/vs/languages/definitions/python/python.js";
```
- Eagerly importing from deep paths inside `../../node_modules/monaco-editor/...` bypasses package exports.
- Any change in npm package layout, pnpm symlinks, or Monaco version upgrades breaks bundling.
- Monaco language configuration is applied up to three separate times across `registerAllLanguages.ts`, `main.tsx`, and `MonacoEditorGroup.tsx`.

---

## 10. Summary Checklist of Actionable Defects

- [ ] **Defect 1:** Resolve all 8 merge conflict markers across frontend and backend.
- [ ] **Defect 2:** Delete or consolidate redundant root folders into a unified structure.
- [ ] **Defect 3:** Re-architect program execution so student stdin routes to the running binary and stdout does not pollute the PTY shell.
- [ ] **Defect 4:** Fix binary naming on Windows in `runners/c.rs` and `runners/cpp.rs` (`EXE_SUFFIX`).
- [ ] **Defect 5:** Remove committed `.exe`, `.msi`, `.deb`, and `.dmg` binaries from the repository and configure GitHub Releases.
- [ ] **Defect 6:** Relocate `.github/workflows` to the root and fix build targets.
- [ ] **Defect 7:** Replace `../../node_modules/` deep imports in `registerAllLanguages.ts` with standard package imports.
- [ ] **Defect 8:** Make file operations resilient to Windows file-locking.
- [ ] **Defect 9:** Clarify the Extension UI so users know extensions are built-in toolchains rather than simulated marketplace downloads.
