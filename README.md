# CodeUI

A lightweight, lab-safe desktop Integrated Development Environment (IDE) built for college computer laboratories and practical programming examinations.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Release](https://img.shields.io/github/v/release/iamriteshhh/CodeUI?color=blue)](https://github.com/iamriteshhh/CodeUI/releases)

---

## Download & Installation

Download standalone installers and ready-to-run packages — no terminal or dev tools required:

| Platform | Format | Direct Download | Description |
| :--- | :--- | :--- | :--- |
| **Windows** | `.exe` | [**Download Windows Setup (64-bit)**](https://github.com/iamriteshhh/CodeUI/releases/latest) | Complete Setup Wizard with Start Menu & Desktop shortcuts, clean uninstaller |
| **Windows** | `.msi` | [**Download Windows MSI**](https://github.com/iamriteshhh/CodeUI/releases/latest) | Windows Installer package for enterprise / system-wide deployments |
| **Linux** | `.AppImage` | [**Download Linux AppImage**](https://github.com/iamriteshhh/CodeUI/releases/latest) | Single-file executable, runs directly on Ubuntu, Debian, Fedora, Arch |
| **Linux** | `.deb` | [**Download Debian Package**](https://github.com/iamriteshhh/CodeUI/releases/latest) | Standard `.deb` package for Ubuntu, Debian, Linux Mint |
| **macOS** | `.dmg` | [**Download macOS DMG**](https://github.com/iamriteshhh/CodeUI/releases/latest) | macOS disk image for Intel and Apple Silicon Macs |

### Building Production Installers Locally
You can generate the native installers on your machine at any time:
```bash
npm run tauri build
```
The output installer will be located at:
- **Windows**: `target/release/bundle/nsis/CodeUI_0.1.0_x64-setup.exe` (only **~1.5 MB**)
- **Linux**: `target/release/bundle/appimage/` and `bundle/deb/`
- **macOS**: `target/release/bundle/dmg/`

---

### App Store & Microsoft Store Publishing
- **Microsoft Store**: CodeUI can be submitted directly through the [Microsoft Partner Center](https://partner.microsoft.com/dashboard). Microsoft Store natively accepts Win32 installers (`.exe` or `.msi`) with zero code modifications.
- **Mac App Store / Notarization**: Tauri apps can be signed with an Apple Developer ID certificate and notarized using standard Xcode CLI tools (`xcrun notarytool`).


## Overview

Many college computer laboratories restrict students to bare text editors (such as Notepad, gedit, or nano) during practical exams because modern IDEs include autocomplete, IntelliSense, and AI coding assistants that compromise exam integrity.

Stripping away all editor capabilities makes lab practicals harder without improving assessment quality. Students lose:
- Syntax highlighting and visual bracket matching
- Integrated terminal access (requiring constant window-switching)
- Real file and project management
- Supervised compilation and formatted diagnostic output

**CodeUI** fills the gap between bare text editors and full-blown automated IDEs. It provides students with a modern, focused programming environment while strictly omitting autocomplete, code suggestions, and AI assistance.

---

## Key Principles

- **Zero Assistance**: No autocomplete, no code suggestions, no Copilot/AI features, and no automated grading.
- **Lab-Safe Execution**: Student code runs in isolated process groups with watchdog timeouts, preventing runaway processes or orphaned background tasks on shared lab machines.
- **Self-Contained Workspace**: Integrated terminal and one-click build/run systems avoid switching between windows.
- **Clean Scratch Builds**: Compiler outputs and temporary build artifacts are placed in sandboxed scratch directories, keeping student project folders clean.

---

## Features

- **Code Editor**: Clean interface with syntax highlighting, line numbers, bracket matching, and multi-tab editing.
- **Supported Languages**:
  - C and C++ (via `gcc` / `g++`)
  - Python (via `python3` / `python` with unbuffered output)
  - Java (with class and package entry-point detection)
  - Salivo
  - Web Development (HTML, CSS, JavaScript with preview pane)
- **Integrated Terminal**: Native PTY sessions powered by `portable-pty` and `xterm.js`.
- **Process Supervisor**: Escalated process termination, output stream batching to protect the UI, and configurable timeout enforcement.
- **Environment Detection**: Automatic scanning of system `$PATH` for required compilers, interpreters, and shells.
- **File Explorer**: Project directory management (create, rename, delete, tree view).

---

## Architecture & Stack

- **Backend**: Rust, Tauri 2.x, `portable-pty`, `which`
- **Frontend**: React 18, TypeScript, Monaco Editor, `xterm.js`, Vite
- **Platforms**: Linux (Ubuntu primary target for labs) and Windows (native support via ConPTY and Win32 process management)

---

## Getting Started

### Prerequisites

Ensure the following tools are installed on your system:
- Node.js (v18 or higher) and npm
- Rust toolchain (`rustc`, `cargo`)
- Target language compilers as needed (`gcc`, `g++`, `python3`/`python`, JDK `javac`/`java`)

### Installation

Clone the repository and install frontend dependencies:

```bash
git clone https://github.com/iamriteshhh/CodeUI.git
cd CodeUI
npm install
```

### Running in Development

Start the development server and desktop app:

```bash
npm run tauri dev
```

### Running Tests

Run the backend test suite:

```bash
cargo test --workspace
```

Run the frontend type checks and build:

```bash
npm run build
```

---

## Founders & Core Contributors

CodeUI was conceived, architected, and engineered by:

<table>
  <tr>
    <td align="center" width="50%">
      <br />
      <a href="https://github.com/iamriteshhh">
        <img src="https://github.com/iamriteshhh.png" width="110" style="border-radius: 4px;" alt="Ritesh" />
        <br /><br />
        <b>Ritesh</b>
      </a>
      <br />
      <sub>Founder & Lead Developer</sub>
      <br /><br />
      <a href="https://github.com/iamriteshhh">
        <img src="https://img.shields.io/badge/GitHub-iamriteshhh-181717?style=flat&logo=github" alt="GitHub" />
      </a>
      <br /><br />
      <sub>Conceived the project idea, created the repository, and designed and developed the frontend editor interface and workspace.</sub>
      <br /><br />
    </td>
    <td align="center" width="50%">
      <br />
      <a href="https://github.com/Serion89">
        <img src="https://github.com/Serion89.png" width="110" style="border-radius: 4px;" alt="Sahil Bhatt" />
        <br /><br />
        <b>Sahil Bhatt</b>
      </a>
      <br />
      <sub>Co-Founder & Backend Developer</sub>
      <br /><br />
      <a href="https://github.com/Serion89">
        <img src="https://img.shields.io/badge/GitHub-Serion89-181717?style=flat&logo=github" alt="GitHub" />
      </a>
      <br /><br />
      <sub>Architected and engineered the desktop backend core; leading Tauri IPC services, process-group isolation, PTY terminal lifecycle, and execution pipelines.</sub>
      <br /><br />
    </td>
  </tr>
</table>

---

## License

This project is licensed under the MIT License.
