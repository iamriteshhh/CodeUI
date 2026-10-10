# Salivo for Visual Studio Code (v1.0.20)

The official Visual Studio Code and Antigravity IDE extension for the **Salivo Programming Language** (`.sal`, `.sf`) — a high-performance, expressive systems language combining zero-boilerplate syntax with native LLVM speed, instant binary execution caching (~20ms), deterministic RAII memory safety, and native Language Server Protocol (LSP) intelligence.

---

## What's New in 1.0.20

- Stage 3 compiles more programs natively instead of falling back to the Rust compiler: `sizeof`, `alignof` and `strideof` of structs, enums and generic structs such as `Wrapper<bool>`, and `drop<T>(x)`, so std.mem `Slice` programs build on Stage 3.
- Raw memory: `Slice<bool>` and `Slice<byte>` store one byte per element (an 8-byte write used to overwrite the neighbouring elements, on both compilers).
- `Slice` of a struct, and `readval`, `writeval`, `cloneval` and `moveval` of structs, work on Stage 3, including structs with `string` and `Vec<T>` fields; `Slice<string>` and `Slice<Vec<T>>` too.
- The Rust compiler lays out struct fields in declaration order (it used alphabetical order), so both compilers agree on struct sizes and on the bytes in memory.

## What's New in 1.0.19

- Stage 3 now compiles `String` and `StrSlice` fields natively, so std.strings functions such as `chars` and `stepchar` no longer fall back to the Rust compiler.
- Faster toolchain: JSON parsing of a 1.1 MB file went from 49 s to 7 ms, pretty-print and minify take about 25 ms, text `join` and `title` run in linear time, HashMap churn is 3.3x faster, integer-to-string 1.7x faster and `outln` about 20% faster.
- The compiler builds itself faster (2.9 s to 2.3 s) and uses less memory (peak 592 MB to 465 MB).
- Memory leak fixes: `salivo.std.web` keeps flat memory per connection, spawn/join no longer leaks, and temporary structs are freed.
- The execution cache notices edits to runtime source files and rebuilds when needed.
- Language server diagnostics are debounced so typing stays smooth.

## What's New in 1.0.18

- `spm new <name> --template fullstack`: `backend/` (salivo.std.web server: API under `/api`, serves the frontend) + `frontend/` (salivo.std.ui WebAssembly UI) + `AGENTS.md` that tells people and AI agents where every file goes (docs/PROJECT_LAYOUT.md). The `web` and `game` templates now use the standard library.
- `sf build <package> --target wasm32` builds multi-file frontend packages; `salivo.std.web` gains `serveStatic`.
- Stage 3 compiler: a function declared by several std modules no longer binds to the wrong module (std.web handlers that did not import `sendText` failed to build).
- Stage 38.3 engine layer: PNG/JPEG/GIF textures, sprite sheets and animation, fonts and text, audio (`salivo.std.audio`), 2D physics, tile maps and an immediate-mode GUI; `examples/game/game_platformer.sal`.
- Snippets: `webrouter` and `sqlite` now generate salivo.std.web / salivo.std.db code (the legacy package APIs are gone).

## What's New in 1.0.17

- **Language Server Protocol (`salivo-lsp`)**: The extension now automatically launches the official Salivo Language Server (stdio) for real-time diagnostics (syntax, semantics, and linting), hover documentation, go-to-definition, symbol outlines, references, and code folding. Edits are debounced (200ms) with full AST and semantic model caching. Configured via `salivo.lsp.enabled` (default `true`) and `salivo.lspPath`.
- **Whole-Toolchain Optimization**: 7,000x faster JSON parsing (1.1 MB in 7ms vs 49s), accelerated integer formatting, instant stdout flushing, linear string joining, optimized HashMap tombstone cleanup, and complete elimination of temporary struct shell memory leaks.
- **Stage 38 Desktop & Graphics**: Native support and snippets for desktop windowing (`salivo.std.desktop`) and game loops (`salivo.std.game`).
- **PowerShell Terminal Compatibility**: Streamlined terminal invocation with automatic `&` call operator handling on Windows PowerShell.

## What's New in 1.0.16

- **System Telemetry & Process Runtime**: Native integration with `salivo.std.sys` (process snapshots, PDH performance counters, services, registry, SMBIOS, text store, and heap census).
- **Expanded Standard Libraries**: Added `std.args`, `std.process.run`, `std.text`, `std.regex`, `std.json`, `std.csv`, `std.datetime`, `std.stats`, `std.uuid`, `std.ini`, `std.template`, `std.log`, and `std.mongo`.
- **SPM Native Task Runner**: Direct execution of package scripts defined under `[scripts]` in `salivo.toml` via `spm run <script>` (or `spm run --list`).
- **Isolated Connection Heaps**: Per-connection memory heaps in `salivo.std.web` for bounded server memory footprint.

---

## Key Features

### 1. Official Language Server Protocol (`salivo-lsp`)
* **Real-time Diagnostics**: Immediate inline compiler errors, type mismatches, and linter warnings as you type.
* **Navigation & Introspection**: Go to Definition (`F12`), Find References (`Shift+F12`), Hover tooltips for types and signatures, and Document Outline symbols (`Ctrl+Shift+O`).
* **Debounced Parsing**: 200ms debounce ensures fluid editor responsiveness with zero CPU lag on large files.

### 2. Instant Sub-30ms Warm Execution (`ExecCache`)
* **Instant Re-execution**: Re-running unmodified `.sal` files triggers Salivo's native binary hash cache (`ExecCache`), executing pre-compiled executables in **~20–30 ms** without re-linking.

### 3. Stream Header Import Syntax (`><`)
* **Exclusive Stream Imports**: Vivid visual highlighting for canonical stream imports:
  ```salivo
  ><salivo.std.core::{assert, assertEq, Option, Result, some, none, ok, err, Drop};
  ><salivo.std.fs::{pathJoin, pathExists, open, close};
  ><salivo.std.db::{dbConnect, query, execute, close};
  ><salivo.std.web::{Router, serverNew, get, post, listen};
  ><salivo.std.sys::{processList, osVersion, cpuUsage};
  ```

### 4. Error Handling (`Result`) & Deterministic Cleanup (`Drop`)
* **Fallible Operations**: Full support for `Result<T, E>` and `Option<T>` monads alongside the postfix try operator (`?`).
* **RAII `Drop` Trait**: Full keyword and semantic support for `pub trait Drop { func drop(self); }` ensuring deterministic cleanup at scope exit.

### 5. Zero-Underscore Type System & Modern `camelCase` Stdlib
* **Type System Integrity**: Clean PascalCase types (`Point`, `Option`, `Result`, `FileMetadata`, `TcpStream`).
* **Modern Identifiers**: Standard library supports clean `camelCase` (`pathJoin`, `pathExists`, `assertEq`, `assertStrEq`, `sha256Hex`, `pushStr`, `stringNew`, `readByte`) alongside backwards-compatible aliases.
* **String Literal Auto-Coercion**: Raw literals (`"hello"`) automatically coerce to borrowed `StrSlice` or owned `String`.

### 6. Zero-Underscore `:modifier` & Global Builtins
* **Postfix Modifiers**: Inline modifiers such as `:trim`, `:upper`, `:lower`, `:len`, `:slice(0, 5)`, `:int`, `:float`, and `:str`.
* **Clean Global Builtins**: First-class support for `in()`, `input()`, `env()`, `out()`, `outln()`, `print()`, `println()`, `len()`, `panic()`, and `assert()`.

### 7. Formatted String Interpolation (`$"..."`)
* Syntax highlighting for embedded interpolation blocks `$"User: {name:trim:upper} | Total: {cost:str}"`.
* Scoped expression and modifier parsing inside `{...}` template strings.

### 8. Full-Stack Standard Library & Systems Ecosystem
* **High-Performance Web**: Native async HTTP/1.1 and HTTP/2 routing with `salivo.std.web`.
* **Database Pooling**: Native integration with `salivo.std.db` for SQLite, PostgreSQL, MySQL, and MongoDB connection pools and parameterized queries.
* **Hardware & OS Telemetry**: Native kernel and performance telemetry through `salivo.std.sys`.
* **Desktop & Game Primitives**: Cross-platform windowing and rendering through `salivo.std.desktop` and `salivo.std.game`.

### 9. Integrated One-Click Tooling
* **Run File (`Ctrl+F5`)**: One-click play button in the editor title bar. Automatically saves, compiles, and executes with sub-30ms execution caching.
* **Build Native Binary (`Ctrl+Shift+B`)**: Compiles active file into an optimized standalone native executable.
* **Check Syntax & Types (`Ctrl+Shift+K`)**: Fast semantic analysis without code generation.
* **Format Source Code (`Shift+Alt+F`)**: Automatic document formatting on save or via `salivofmt --stdin`.
* **Lint Source Code (`Ctrl+Shift+L`)**: Official static analysis with `salivolint`.
* **Run Tests**: Execute `spm test` directly from editor context menus.

---

## Quick Start

1. Create a file named `main.sal`:
```salivo
module main;

><salivo.std.core::{out, outln, assertEq};

pub struct Greeter {
    appName: string,
}

impl Drop for Greeter {
    func drop(self) {
        outln($"[RAII] Shutting down {self.appName} cleanly.");
    }
}

func main() -> int {
    let greeter = Greeter { appName: "Salivo Service" };
    out("Enter your name: ");
    let name = in():trim:upper;

    let port = env("PORT", "8080"):int;
    outln($"Welcome {name}! Service {greeter.appName} listening on port {port}.");

    assertEq(1 + 1, 2);
    return 0;
}
```

2. Press `Ctrl+F5` (or click the Play button in the top right) to run instantly!

---

## Keyboard Shortcuts

| Command | Shortcut | Description |
| :--- | :---: | :--- |
| `salivo.runFile` | `Ctrl + F5` | Saves and runs active file with sub-30ms warm binary caching |
| `salivo.buildFile` | `Ctrl + Shift + B` | Compiles active file into an optimized native `.exe` |
| `salivo.checkFile` | `Ctrl + Shift + K` | Rapidly checks syntax and types without codegen |
| `salivo.formatFile` | `Shift + Alt + F` | Formats active document buffer via `salivofmt` |
| `salivo.lintFile` | `Ctrl + Shift + L` | Analyzes code for warnings and anti-patterns via `salivolint` |
| `salivo.testFile` | *(Context Menu)* | Executes test suite via `spm test` |

---

## Extension Settings

You can customize binary locations and behaviors under **Settings > Extensions > Salivo**:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `salivo.lsp.enabled` | `true` | Enable the Salivo Language Server for real-time diagnostics, hover, and go-to-definition. |
| `salivo.lspPath` | `""` *(uses ~/.salivo/bin/salivo-lsp.exe)* | Custom path to the Salivo Language Server (`salivo-lsp`). |
| `salivo.executablePath` | `""` *(uses ~/.salivo/bin/sf.exe)* | Custom path to the Salivo compiler executable (`sf`). |
| `salivo.formatterPath` | `""` *(uses ~/.salivo/bin/salivofmt.exe)* | Custom path to the code formatter (`salivofmt`). |
| `salivo.linterPath` | `""` *(uses ~/.salivo/bin/salivolint.exe)* | Custom path to the static analysis linter (`salivolint`). |
| `salivo.packageManagerPath` | `""` *(uses ~/.salivo/bin/spm.exe)* | Custom path to the Salivo Package Manager (`spm`). |
| `salivo.enableExecCache` | `true` | Enable sub-30ms warm execution binary caching. |

---

## Built-in Snippets Reference

| Prefix | Description | Generated Code Pattern |
| :--- | :--- | :--- |
| `main` | Entry point | `module main; func main() -> int { ... }` |
| `func` / `pubfunc` | Functions | `func name(params) -> type { ... }` |
| `test` | Unit test | `pub func test_name() -> int { assertEq(...); }` |
| `struct` / `pubstruct` | Structs | `pub struct Name { field: type, }` |
| `enum` / `pubenum` | Enums | `pub enum Status { Variant1, Variant2 }` |
| `trait` / `impl` | Traits | `trait Name { ... }` / `impl Trait for Type { ... }` |
| `drop` | RAII Drop | `impl Drop for Type { func drop(self) { ... } }` |
| `for` | 3-Clause Loop | `for (let mut i = 0; i < 10; i = i + 1) { ... }` |
| `while` | Loop | `while (condition) { ... }` |
| `try` | Error propagation | `let val = fallible()?` |
| `importcore` / `importfs` / `importcoll` | Stream imports | `><salivo.std.core::{...};` |
| `vec` / `map` / `stringnew` | Collections | Dynamic vectors, hash maps, and owned heap strings |
| `sqlite` / `webrouter` | Backend | `@salivo/sqlite` database operations and `@salivo/web` router |
