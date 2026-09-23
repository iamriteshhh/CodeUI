import { useState, useEffect, useCallback } from "react";
import { FileEntry, OpenFile, ToolStatus, UserSettings } from "../types";
import { fsService } from "../services/fsService";
import { envService } from "../services/envService";
import { settingsService } from "../services/settingsService";
import { ptyService } from "../services/ptyService";
import { editorService } from "../services/editorService";

function detectLanguage(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower === "cargo.toml" || lower === "cargo.lock") return "toml";
  if (lower === "package.json") return "json";
  if (lower.startsWith(".git")) return "git";
  if (lower === "dockerfile") return "dockerfile";

  const ext = lower.split(".").pop() || "";
  switch (ext) {
    case "java":
      return "java";
    case "py":
    case "pyw":
      return "python";
    case "c":
    case "h":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hxx":
    case "hh":
      return "cpp";
    case "rs":
      return "rust";
    case "sal":
    case "salivo":
    case "sf":
    case "slv":
      return "salivo";
    case "zig":
      return "zig";
    case "html":
    case "htm":
      return "html";
    case "css":
    case "scss":
    case "sass":
    case "less":
      return "css";
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
      return "javascript";
    case "ts":
    case "mts":
    case "cts":
    case "tsx":
      return "typescript";
    case "json":
    case "jsonc":
    case "json5":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "toml":
      return "toml";
    case "yaml":
    case "yml":
      return "yaml";
    case "xml":
    case "svg":
      return "xml";
    case "sql":
      return "sql";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "bat":
    case "cmd":
      return "bat";
    case "ps1":
      return "powershell";
    case "php":
      return "php";
    case "go":
      return "go";
    case "rb":
      return "ruby";
    case "lua":
      return "lua";
    case "cs":
      return "csharp";
    case "kt":
    case "kts":
      return "kotlin";
    case "swift":
      return "swift";
    default:
      return "plaintext";
  }
}

export function useWorkspace() {
  const [workspacePath, setWorkspacePath] = useState<string>("D:\\JAVA");
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [splitActiveFilePath, setSplitActiveFilePath] = useState<string | null>(null);
  const [isSplit, setIsSplit] = useState<boolean>(false);

  // Layout states
  const [sidebarTab, setSidebarTab] = useState<"explorer" | "extensions" | "search" | "run">("explorer");
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

  const [panelVisible, setPanelVisible] = useState<boolean>(false);
  const [panelHeight, setPanelHeight] = useState<number>(240);
  const [activePanelTab, setActivePanelTab] = useState<"terminal" | "preview">("terminal");

  // Welcome tab state
  const [isWelcomeOpen, setIsWelcomeOpen] = useState<boolean>(true);
  const [recentFolders, setRecentFolders] = useState<string[]>([
    "D:\\JAVA",
    "C:\\Users\\sahil\\CodeUI",
  ]);
  const [showWelcomeOnStartup, setShowWelcomeOnStartup] = useState<boolean>(true);

  // Tools & Settings
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [settings, setSettings] = useState<UserSettings>({
    theme: "dark",
    fontSize: 14,
    tabWidth: 4,
    runTimeoutSecs: 12,
    recentFolders: ["D:\\JAVA", "C:\\Users\\sahil\\CodeUI"],
    showWelcomeOnStartup: true,
  });

  // PTY Session
  const [ptySessionId, setPtySessionId] = useState<string | null>(null);

  // Load initial settings and toolchains
  useEffect(() => {
    settingsService.loadSettings().then((s) => {
      setSettings(s);
      if (s.lastFolder) {
        setWorkspacePath(s.lastFolder);
      }
      if (s.recentFolders && s.recentFolders.length > 0) {
        setRecentFolders(s.recentFolders);
      }
      if (s.showWelcomeOnStartup !== undefined) {
        setShowWelcomeOnStartup(s.showWelcomeOnStartup);
        setIsWelcomeOpen(s.showWelcomeOnStartup);
      }
    });

    envService.detectTools().then(setTools);
  }, []);

  // Load file tree when workspace changes
  const refreshExplorer = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const entries = await fsService.listDir(workspacePath);
      setFileTree(entries);
    } catch (err) {
      console.error("Failed to load directory:", err);
    }
  }, [workspacePath]);

  useEffect(() => {
    refreshExplorer();
  }, [refreshExplorer]);

  // Open file into tabs
  const openFileByPath = useCallback(
    async (path: string, name?: string) => {
      const existing = openFiles.find((f) => f.path === path);
      if (existing) {
        setActiveFilePath(path);
        return;
      }

      try {
        const fileName = name || path.split(/[/\\]/).pop() || "untitled";
        const content = await fsService.readFile(path);
        const language = detectLanguage(fileName);
        const newFile: OpenFile = {
          path,
          name: fileName,
          content,
          isDirty: false,
          language,
        };

        setOpenFiles((prev) => [...prev, newFile]);
        setActiveFilePath(path);
        if (isSplit && !splitActiveFilePath) {
          setSplitActiveFilePath(path);
        }
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    },
    [openFiles, isSplit, splitActiveFilePath]
  );

  // Close file tab
  const closeFile = useCallback(
    (path: string) => {
      editorService.disposeModel(path);
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== path);
        if (activeFilePath === path) {
          const closedIdx = prev.findIndex((f) => f.path === path);
          const newActive = next[closedIdx] || next[closedIdx - 1] || next[0] || null;
          setActiveFilePath(newActive ? newActive.path : null);
        }
        if (splitActiveFilePath === path) {
          setSplitActiveFilePath(next[0] ? next[0].path : null);
        }
        return next;
      });
    },
    [activeFilePath, splitActiveFilePath]
  );

  // Close all other tabs
  const closeOtherFiles = useCallback((path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path === path));
    setActiveFilePath(path);
  }, []);

  // Update file content in memory (mark dirty)
  const updateFileContent = useCallback((path: string, content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path === path) {
          return { ...f, content, isDirty: true };
        }
        return f;
      })
    );
  }, []);

  // Save file to disk
  const saveFile = useCallback(
    async (path: string) => {
      const target = openFiles.find((f) => f.path === path);
      if (!target) return;
      try {
        await fsService.writeFile(path, target.content);
        const language = detectLanguage(target.name);
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === path ? { ...f, isDirty: false, language } : f))
        );
      } catch (err) {
        console.error("Failed to save file:", err);
      }
    },
    [openFiles]
  );

  // Save active file
  const saveActiveFile = useCallback(() => {
    if (activeFilePath) {
      saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  // Open a new folder workspace
  const openFolder = useCallback(
    (newPath: string) => {
      setWorkspacePath(newPath);
      setOpenFiles([]);
      setActiveFilePath(null);
      setSplitActiveFilePath(null);
      setIsWelcomeOpen(false);

      setRecentFolders((prev) => {
        const next = [newPath, ...prev.filter((p) => p !== newPath)].slice(0, 10);
        settingsService.saveSettings({ ...settings, lastFolder: newPath, recentFolders: next });
        return next;
      });
    },
    [settings]
  );

  const toggleShowWelcomeOnStartup = useCallback(
    (show: boolean) => {
      setShowWelcomeOnStartup(show);
      settingsService.saveSettings({ ...settings, showWelcomeOnStartup: show });
    },
    [settings]
  );

  const updateSettings = useCallback(
    async (newSettings: UserSettings) => {
      setSettings(newSettings);
      await settingsService.saveSettings(newSettings);
    },
    []
  );

  const closeAllFiles = useCallback(() => {
    setOpenFiles([]);
    setActiveFilePath(null);
    setSplitActiveFilePath(null);
    setIsWelcomeOpen(true);
  }, []);

  const switchToNextTab = useCallback(() => {
    if (openFiles.length === 0) return;
    const currentIdx = openFiles.findIndex((f) => f.path === activeFilePath);
    const nextIdx = (currentIdx + 1) % openFiles.length;
    setActiveFilePath(openFiles[nextIdx].path);
  }, [openFiles, activeFilePath]);

  const switchToPrevTab = useCallback(() => {
    if (openFiles.length === 0) return;
    const currentIdx = openFiles.findIndex((f) => f.path === activeFilePath);
    const prevIdx = (currentIdx - 1 + openFiles.length) % openFiles.length;
    setActiveFilePath(openFiles[prevIdx].path);
  }, [openFiles, activeFilePath]);

  // Create new file in workspace
  const createNewFile = useCallback(
    async (fileName: string) => {
      const separator = workspacePath.includes("\\") ? "\\" : "/";
      const fullPath = `${workspacePath}${separator}${fileName}`;
      try {
        await fsService.createFile(fullPath);
        await refreshExplorer();
        await openFileByPath(fullPath, fileName);
      } catch (err) {
        console.error("Failed to create file:", err);
      }
    },
    [workspacePath, refreshExplorer, openFileByPath]
  );

  // Create new folder in workspace
  const createNewFolder = useCallback(
    async (folderName: string) => {
      const separator = workspacePath.includes("\\") ? "\\" : "/";
      const fullPath = `${workspacePath}${separator}${folderName}`;
      try {
        await fsService.createDir(fullPath);
        await refreshExplorer();
      } catch (err) {
        console.error("Failed to create folder:", err);
      }
    },
    [workspacePath, refreshExplorer]
  );

  // Delete file or folder
  const deletePath = useCallback(
    async (path: string) => {
      try {
        await fsService.deleteFile(path);
        closeFile(path);
        await refreshExplorer();
      } catch (err) {
        console.error("Failed to delete path:", err);
      }
    },
    [closeFile, refreshExplorer]
  );

  // Rename file or folder
  const renamePath = useCallback(
    async (oldPath: string, newPath: string) => {
      try {
        await fsService.renameFile(oldPath, newPath);
        closeFile(oldPath);
        await refreshExplorer();
        await openFileByPath(newPath);
      } catch (err) {
        console.error("Failed to rename path:", err);
      }
    },
    [closeFile, refreshExplorer, openFileByPath]
  );

  // Ensure PTY session exists or spawn one
  const ensurePtySession = useCallback(async (preferredId?: string): Promise<string> => {
    if (ptySessionId) return ptySessionId;
    try {
      const id = preferredId || "pty-" + Math.random().toString(36).substring(2, 10);
      const spawnedId = await ptyService.spawnPty({ sessionId: id, cwd: workspacePath });
      const finalId = spawnedId || id;
      setPtySessionId(finalId);
      return finalId;
    } catch (err) {
      console.error("Failed to spawn PTY:", err);
      return "";
    }
  }, [ptySessionId, workspacePath]);

  // Run/Debug active file
  const runActiveFile = useCallback(async () => {
    const active = openFiles.find((f) => f.path === activeFilePath);
    if (!active) return;

    // 1. Auto-save if dirty
    if (active.isDirty) {
      await saveFile(active.path);
    }

    // 2. Open terminal panel
    setPanelVisible(true);
    setActivePanelTab("terminal");

    // 3. Connect/spawn PTY
    const sessionId = await ensurePtySession();
    if (!sessionId) return;

    // 4. Generate command based on language
    const path = active.path;
    const isWin = path.includes("\\");
    const fileName = active.name;
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    const dir = path.substring(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));

    let cmd = "";
    switch (active.language) {
      case "java": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); javac "${fileName}"; $ms = $sw.ElapsedMilliseconds; if ($?) { Write-Host "[Compiled in $($ms)ms]" -ForegroundColor Cyan; java "${baseName}" }\r`;
        } else {
          cmd = `cd "${dir}" && t0=$(date +%s%3N) && javac "${fileName}" && t1=$(date +%s%3N) && echo -e "\\x1b[36m[Compiled in $((t1 - t0))ms]\\x1b[0m" && java "${baseName}"\n`;
        }
        break;
      }
      case "python": {
        if (isWin) {
          cmd = `cd "${dir}"; python -u "${fileName}"\r`;
        } else {
          cmd = `cd "${dir}" && python3 -u "${fileName}"\n`;
        }
        break;
      }
      case "c": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); gcc -Wall -g "${fileName}" -o "${baseName}.exe"; $ms = $sw.ElapsedMilliseconds; if ($?) { Write-Host "[Compiled in $($ms)ms]" -ForegroundColor Cyan; .\\"${baseName}.exe" }\r`;
        } else {
          cmd = `cd "${dir}" && t0=$(date +%s%3N) && gcc -Wall -g "${fileName}" -o "${baseName}" && t1=$(date +%s%3N) && echo -e "\\x1b[36m[Compiled in $((t1 - t0))ms]\\x1b[0m" && ./"${baseName}"\n`;
        }
        break;
      }
      case "cpp": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); g++ -Wall -g -std=c++17 "${fileName}" -o "${baseName}.exe"; $ms = $sw.ElapsedMilliseconds; if ($?) { Write-Host "[Compiled in $($ms)ms]" -ForegroundColor Cyan; .\\"${baseName}.exe" }\r`;
        } else {
          cmd = `cd "${dir}" && t0=$(date +%s%3N) && g++ -Wall -g -std=c++17 "${fileName}" -o "${baseName}" && t1=$(date +%s%3N) && echo -e "\\x1b[36m[Compiled in $((t1 - t0))ms]\\x1b[0m" && ./"${baseName}"\n`;
        }
        break;
      }
      case "rust": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); rustc "${fileName}" -o "${baseName}.exe"; $ms = $sw.ElapsedMilliseconds; if ($?) { Write-Host "[Compiled in $($ms)ms]" -ForegroundColor Cyan; .\\"${baseName}.exe" }\r`;
        } else {
          cmd = `cd "${dir}" && t0=$(date +%s%3N) && rustc "${fileName}" -o "${baseName}" && t1=$(date +%s%3N) && echo -e "\\x1b[36m[Compiled in $((t1 - t0))ms]\\x1b[0m" && ./"${baseName}"\n`;
        }
        break;
      }
      case "salivo": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); sf build "${fileName}"; $ms = $sw.ElapsedMilliseconds; if ($?) { Write-Host "[Compiled in $($ms)ms]" -ForegroundColor Cyan; .\\"${baseName}.exe" }\r`;
        } else {
          cmd = `cd "${dir}" && t0=$(date +%s%3N) && sf build "${fileName}" && t1=$(date +%s%3N) && echo -e "\\x1b[36m[Compiled in $((t1 - t0))ms]\\x1b[0m" && ./"${baseName}"\n`;
        }
        break;
      }
      case "zig": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); zig run "${fileName}"; $sw.Stop(); Write-Host "\`n[Compile & run time: $($sw.ElapsedMilliseconds)ms]" -ForegroundColor Cyan\r`;
        } else {
          cmd = `cd "${dir}" && t0=$(date +%s%3N) && zig run "${fileName}" && t1=$(date +%s%3N) && echo -e "\\n\\x1b[36m[Compile & run time: $((t1 - t0))ms]\\x1b[0m"\n`;
        }
        break;
      }
      case "javascript": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); node "${fileName}"; $sw.Stop(); Write-Host "\`n[Executed in $($sw.ElapsedMilliseconds)ms]" -ForegroundColor Cyan\r`;
        } else {
          cmd = `cd "${dir}" && node "${fileName}"\n`;
        }
        break;
      }
      case "typescript": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); npx ts-node "${fileName}"; $sw.Stop(); Write-Host "\`n[Executed in $($sw.ElapsedMilliseconds)ms]" -ForegroundColor Cyan\r`;
        } else {
          cmd = `cd "${dir}" && npx ts-node "${fileName}"\n`;
        }
        break;
      }
      case "go": {
        if (isWin) {
          cmd = `cd "${dir}"; $sw = [System.Diagnostics.Stopwatch]::StartNew(); go run "${fileName}"; $sw.Stop(); Write-Host "\`n[Compile & run time: $($sw.ElapsedMilliseconds)ms]" -ForegroundColor Cyan\r`;
        } else {
          cmd = `cd "${dir}" && go run "${fileName}"\n`;
        }
        break;
      }
      case "ruby": {
        if (isWin) {
          cmd = `cd "${dir}"; ruby "${fileName}"\r`;
        } else {
          cmd = `cd "${dir}" && ruby "${fileName}"\n`;
        }
        break;
      }
      case "php": {
        if (isWin) {
          cmd = `cd "${dir}"; php "${fileName}"\r`;
        } else {
          cmd = `cd "${dir}" && php "${fileName}"\n`;
        }
        break;
      }
      case "lua": {
        if (isWin) {
          cmd = `cd "${dir}"; lua "${fileName}"\r`;
        } else {
          cmd = `cd "${dir}" && lua "${fileName}"\n`;
        }
        break;
      }
      case "csharp": {
        if (isWin) {
          cmd = `cd "${dir}"; dotnet run\r`;
        } else {
          cmd = `cd "${dir}" && dotnet run\n`;
        }
        break;
      }
      case "shell": {
        if (isWin) {
          cmd = `cd "${dir}"; bash "${fileName}"\r`;
        } else {
          cmd = `cd "${dir}" && bash "${fileName}"\n`;
        }
        break;
      }
      case "powershell": {
        cmd = `cd "${dir}"; & ".\\${fileName}"\r`;
        break;
      }
      case "bat": {
        cmd = `cd "${dir}"; .\\"${fileName}"\r`;
        break;
      }
      case "html": {
        // Switch to preview panel
        setActivePanelTab("preview");
        return;
      }
      default: {
        cmd = `echo "No runner configured for ${active.language}"\r`;
      }
    }

    // 5. Send command to terminal and automatically focus it
    await ptyService.writePty(sessionId, cmd);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("focus-terminal"));
    }, 100);
  }, [activeFilePath, openFiles, saveFile, ensurePtySession]);

  return {
    workspacePath,
    fileTree,
    openFiles,
    activeFilePath,
    splitActiveFilePath,
    isSplit,
    sidebarTab,
    sidebarVisible,
    sidebarWidth,
    panelVisible,
    panelHeight,
    activePanelTab,
    tools,
    settings,
    settingsOpen,
    setSettingsOpen,
    updateSettings,
    isWelcomeOpen,
    setIsWelcomeOpen,
    recentFolders,
    showWelcomeOnStartup,
    toggleShowWelcomeOnStartup,
    closeAllFiles,
    switchToNextTab,
    switchToPrevTab,
    ptySessionId,
    setSidebarTab,
    setSidebarVisible,
    setSidebarWidth,
    setPanelVisible,
    setPanelHeight,
    setActivePanelTab,
    setIsSplit,
    setActiveFilePath,
    setSplitActiveFilePath,
    openFolder,
    openFileByPath,
    closeFile,
    closeOtherFiles,
    updateFileContent,
    saveFile,
    saveActiveFile,
    createNewFile,
    createNewFolder,
    deletePath,
    renamePath,
    refreshExplorer,
    runActiveFile,
    ensurePtySession,
    refreshTools: () => envService.detectTools().then(setTools),
  };
}
