# Salivo for Visual Studio Code (v1.0.14)

The official Visual Studio Code extension for the **Salivo Programming Language** (`.sal`, `.sf`) — a high-performance, expressive systems language combining zero-boilerplate syntax with native LLVM speed, instant binary execution caching (~20ms), and deterministic RAII memory safety.

---

## What's New in 1.0.16

- Ships with Salivo SDK 1.0.16: new `salivo.std.sys` module (processes, performance counters, services, registry, icons, text store, heap census), `std.args`, `std.process.run`, and the text/regex/json/csv/datetime/stats/uuid/ini/template/log/mongo libraries.
- Stage 3 compiler: assert messages are printed; packages build with Stage 3; runtime string returns from every ABI table are recognized by the Rust pipeline.
- `spm run <script>` runs `[scripts]` from `salivo.toml` (`spm run --list` lists them).
- `std.web`: each connection runs in its own heap.
- Demo: a full Task Manager written only in Salivo (`demos/spatial_website`).

## Key Features

### 1. Instant Sub-30ms Warm Execution (`ExecCache`)
* **Instant Re-execution**: Re-running unmodified `.sal` files triggers Salivo's native binary hash cache (`ExecCache`), executing pre-compiled executables in **~20–30 ms** without re-linking.

### 2. Stream Header Import Syntax (`><`)
* **Exclusive Stream Imports**: Vivid visual highlighting for canonical stream imports:
  ```salivo
  ><salivo.std.core::{assert, assertEq, Option, Result, some, none, ok, err, Drop};
  ><salivo.std.fs::{pathJoin, pathExists, open, close};
  ><salivo.std.db::{dbConnect, query, execute, close};
  ><salivo.std.web::{Router, serverNew, get, post, listen};
  ```

### 3. Error Handling (`Result`) & Deterministic Cleanup (`Drop`)
* **Fallible Operations**: Full support for `Result<T, E>` and `Option<T>` monads.
* **RAII `Drop` Trait**: Full keyword and semantic support for `pub trait Drop { func drop(self); }` ensuring deterministic cleanup at scope exit.

### 4. Zero-Underscore Type System & Modern `camelCase` Stdlib
* **Type System Integrity**: Clean PascalCase types (`Point`, `Option`, `Result`, `FileMetadata`, `TcpStream`).
* **Modern Identifiers**: Standard library supports clean `camelCase` (`pathJoin`, `pathExists`, `assertEq`, `assertStrEq`, `sha256Hex`, `pushStr`, `stringNew`, `readByte`) alongside backwards-compatible aliases.
* **String Literal Auto-Coercion**: Raw literals (`"hello"`) automatically coerce to borrowed `StrSlice` or owned `String`.

### 5. Zero-Underscore `:modifier` & Global Builtins
* **Postfix Modifiers**: Inline modifiers such as `:trim`, `:upper`, `:lower`, `:len`, `:slice(0, 5)`, `:int`, `:float`, and `:str`.
* **Clean Global Builtins**: First-class support for `in()`, `input()`, `env()`, `out()`, `outln()`, `print()`, `println()`, `len()`, `panic()`, and `assert()`.

### 6. Formatted String Interpolation (`$"..."`)
* Syntax highlighting for embedded interpolation blocks `$"User: {name:trim:upper} | Total: {cost:str}"`.
* Scoped expression and modifier parsing inside `{...}` template strings.

### 7. Database & Web Ecosystem (v1.0.14)
* **Database Pooling**: Native integration with `salivo.std.db` for SQLite connection pools and parameterized queries.
* **High-Performance Web**: Native async HTTP routing with `salivo.std.web`.

### 8. Integrated One-Click Tooling
* **Run File (`Ctrl+F5`)**: One-click play button in the editor title bar. Automatically saves, compiles, and executes with sub-30ms execution caching.
* **Build Native Binary (`Ctrl+Shift+B`)**: Compiles active file into an optimized standalone native executable.
* **Check Syntax & Types (`Ctrl+Shift+K`)**: Fast semantic analysis without code generation.
* **Format Source Code (`Shift+Alt+F`)**: Automatic document formatting on save or via command via `salivofmt --stdin`.
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
