# CodeUI Troubleshooting Guide

This guide covers common platform-specific questions, rendering workarounds, and toolchain configurations for **Windows** and **Ubuntu/Linux** laboratory environments.

---

## 1. Linux & WebKitGTK Rendering / GPU Issues

If running CodeUI inside a virtual machine (e.g. VMware, VirtualBox, WSLg) or with certain NVIDIA drivers where the editor canvas or window flickers or renders blank:

### WebKitGTK Compositing / DMA-BUF Workarounds
Run CodeUI from your terminal with one or both of the following environment variables:

```bash
# Disable WebKit hardware compositing mode (common fix for virtual machines)
WEBKIT_DISABLE_COMPOSITING_MODE=1 codeui

# Disable DMA-BUF renderer (resolves driver crashes on older Mesa/NVIDIA setups)
WEBKIT_DISABLE_DMABUF_RENDERER=1 codeui

# Or combine both:
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 codeui
```

If you installed via AppImage:
```bash
WEBKIT_DISABLE_COMPOSITING_MODE=1 ./CodeUI_*.AppImage
```

---

## 2. Linux AppImage & FUSE (Ubuntu 24.04+)

On Ubuntu 24.04 LTS and newer distributions, `libfuse2` is no longer installed by default. Running an AppImage may display:
`dlopen(): error loading libfuse.so.2`

### Solution:
Install the FUSE 2 compatibility library:
```bash
sudo apt install libfuse2t64
```
*(On Ubuntu 22.04, `sudo apt install libfuse2`)*

Alternatively, run without FUSE by extracting the AppImage:
```bash
./CodeUI_*.AppImage --appimage-extract-and-run
```

---

## 3. Windows & WebView2 Runtime

CodeUI requires the Microsoft Edge WebView2 Evergreen Runtime.
- **Windows 11**: Pre-installed out of the box.
- **Windows 10**: Usually installed by Windows Update, but on offline or bare-metal college lab machines, you may need to install the standalone offline installer.

### Offline Lab Installation
Download the **WebView2 Evergreen Standalone Installer (x64)** from Microsoft:
[https://developer.microsoft.com/en-us/microsoft-edge/webview2/](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) and run it on lab machines before distributing CodeUI.

---

## 4. Compiler & Tool Detection ($PATH)

CodeUI scans your system environment for language compilers and interpreters when you run a file.

### Windows
- **C / C++ (`gcc`, `g++`)**: Install MinGW-w64 (e.g. via MSYS2 `pacman -S mingw-w64-ucrt-x86_64-gcc` or WinLibs). Ensure `C:\msys64\ucrt64\bin` is added to your User or System `PATH`.
- **Python**: Install Python 3 from python.org. Check "Add Python to PATH" during installation. The `py` launcher or `python.exe` will be automatically detected.
- **Java**: Install JDK (e.g. Eclipse Temurin or Oracle JDK). Ensure `%JAVA_HOME%\bin` or `javac.exe` is in your `PATH`.
- *Note on PATH Changes*: If you modify your system `PATH` while CodeUI is open, CodeUI will re-read user and system environment paths from the Windows Registry when detecting tools.

### Ubuntu / Debian Linux
- **C / C++**: `sudo apt install build-essential`
- **Python**: `sudo apt install python3`
- **Java**: `sudo apt install default-jdk`

*Note on GUI Launchers*: When launching CodeUI from a desktop application menu (which does not source `.bashrc`), CodeUI queries your login shell environment to automatically discover tools installed under `~/.local/bin`, `~/.cargo/bin`, or custom paths.

---

## 5. Diagnostic Reports

If you experience unexpected behavior or missing toolchains, open CodeUI and access **Copy Diagnostics**:
1. Click the status bar or open the command palette.
2. Select **Copy Diagnostics**.
3. The report will contain:
   - Application version, Git SHA, and build timestamp
   - Operating system and architecture
   - Resolved compiler paths (`gcc`, `g++`, `python`, `javac`, etc.)
   - Active PTY session IDs and status
   - Monaco registered languages and active editor layout dimensions

Include this report when reporting bugs or submitting issues.
