import { useState, useEffect, useCallback } from "react";
import { FileEntry, OpenFile, ToolStatus, UserSettings } from "../types";
import { fsService } from "../services/fsService";
import { envService } from "../services/envService";
import { settingsService } from "../services/settingsService";
import { ptyService } from "../services/ptyService";

function detectLanguage(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "java":
      return "java";
    case "py":
      return "python";
    case "c":
      return "c";
    case "cpp":
    case "cc":
    case "cxx":
    case "h":
    case "hpp":
      return "cpp";
    case "html":
    case "htm":
      return "html";
    case "css":
      return "css";
    case "js":
      return "javascript";
    case "ts":
      return "typescript";
    case "json":
      return "json";
    case "md":
      return "markdown";
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
  const [sidebarTab, setSidebarTab] = useState<"explorer" | "extensions" | "search">("explorer");
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(260);

  const [panelVisible, setPanelVisible] = useState<boolean>(false);
  const [panelHeight, setPanelHeight] = useState<number>(240);
  const [activePanelTab, setActivePanelTab] = useState<"terminal" | "preview">("terminal");

  // Tools & Settings
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [settings, setSettings] = useState<UserSettings>({
    theme: "dark",
    fontSize: 14,
    tabWidth: 4,
    runTimeoutSecs: 12,
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
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === path ? { ...f, isDirty: false } : f))
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
      settingsService.saveSettings({ ...settings, lastFolder: newPath });
    },
    [settings]
  );

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
  const ensurePtySession = useCallback(async (): Promise<string> => {
    if (ptySessionId) return ptySessionId;
    try {
      const id = await ptyService.spawnPty({ cwd: workspacePath });
      setPtySessionId(id);
      return id;
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
        // e.g. cd <dir> ; javac <file> ; java <class>
        if (isWin) {
          cmd = `cd "${dir}"; javac "${fileName}"; if ($?) { java "${baseName}" }\r`;
        } else {
          cmd = `cd "${dir}" && javac "${fileName}" && java "${baseName}"\n`;
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
          cmd = `cd "${dir}"; gcc -Wall -g "${fileName}" -o "${baseName}.exe"; if ($?) { .\\"${baseName}.exe" }\r`;
        } else {
          cmd = `cd "${dir}" && gcc -Wall -g "${fileName}" -o "${baseName}" && ./"${baseName}"\n`;
        }
        break;
      }
      case "cpp": {
        if (isWin) {
          cmd = `cd "${dir}"; g++ -Wall -g -std=c++17 "${fileName}" -o "${baseName}.exe"; if ($?) { .\\"${baseName}.exe" }\r`;
        } else {
          cmd = `cd "${dir}" && g++ -Wall -g -std=c++17 "${fileName}" -o "${baseName}" && ./"${baseName}"\n`;
        }
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

    // 5. Send command to terminal
    await ptyService.writePty(sessionId, cmd);
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
