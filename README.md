# CodeUI

A lightweight, lab-safe desktop Integrated Development Environment (IDE) built for college computer laboratories and practical programming examinations.

[![Project Lead](https://img.shields.io/badge/Project%20Lead%20%26%20Frontend-iamriteshhh-blue?style=flat&logo=github)](https://github.com/iamriteshhh)
[![Backend Developer](https://img.shields.io/badge/Backend%20Developer-Serion89-black?style=flat&logo=github)](https://github.com/Serion89)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

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

## Authors & Roles

- **Ritesh** ([@iamriteshhh](https://github.com/iamriteshhh)) — Project Concept, Repository Owner, and Frontend Development.
- **Sahil Bhatt** ([@Serion89](https://github.com/Serion89)) — Backend Development.

The concept and repository were originated by Ritesh to provide a controlled coding environment tailored for academic evaluations. Frontend engineering is led by Ritesh, with backend development by Sahil.

---

## License

This project is licensed under the MIT License.
