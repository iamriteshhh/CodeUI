# CodeUI Installers

Release packages for every platform are committed in `installer/dist/` (stored with Git LFS, so run `git lfs pull` after cloning) and are also published on GitHub Releases. `SHA256SUMS.txt` lists their checksums.

### Official Releases & Downloads

All official binaries, installers, and SHA-256 checksums are published at:  
👉 **[CodeUI Releases](https://github.com/iamriteshhh/CodeUI/releases/latest)**

| Operating System | Package Type | Format | Description |
| :--- | :--- | :--- | :--- |
| **Windows** | Setup Wizard | `.exe` | Standard NSIS installer (`CodeUI_<version>_x64-setup.exe`) with Start Menu & Desktop shortcuts. |
| **Windows** | MSI Package | `.msi` | Windows Installer package (`CodeUI_<version>_x64_en-US.msi`) for enterprise / lab deployments. |
| **Linux (Debian/Ubuntu)** | Native Debian Package | `.deb` | Install with `sudo dpkg -i CodeUI_<version>_amd64.deb`. |
| **Linux (Universal)** | Portable AppImage | `.AppImage` | Portable binary: `chmod +x CodeUI_<version>_amd64.AppImage && ./CodeUI_<version>_amd64.AppImage`. *(Note: Ubuntu 24.04 requires `sudo apt install libfuse2t64`)* |
| **macOS** | Disk Image | `.dmg` | Mount and drag `CodeUI.app` into `/Applications`. |

> **Lab deployment note:** student programs are sandboxed on Linux (kernel permitting) but only *supervised* on Windows (resource limits, no network or filesystem isolation). See *Security model* in the main [README](../README.md#security-model).

### Verifying Checksums

Each release includes a verified `SHA256SUMS.txt` file.

**Windows (PowerShell):**
```powershell
Get-FileHash -Algorithm SHA256 .\CodeUI_*_x64-setup.exe
```

**Linux / macOS:**
```bash
sha256sum -c SHA256SUMS.txt
```

### Building Installers Locally

To build a standalone installer on your current machine:
```bash
npm run tauri build
```
The output packages will be created in `src-tauri/target/release/bundle/`.
