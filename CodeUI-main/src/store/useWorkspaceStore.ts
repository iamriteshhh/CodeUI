import { useState, useEffect, useCallback, useRef } from "react";
import { FileEntry, OpenFile, ToolStatus, UserSettings } from "../types";
import { fsService } from "../services/fsService";
import { envService } from "../services/envService";
import { settingsService } from "../services/settingsService";
import { ptyService } from "../services/ptyService";
import { processService } from "../services/processService";
import { editorService } from "../services/editorService";
import { notify, formatError } from "../services/notify";
import { parseCompilerDiagnostics } from "../services/diagnostics";
import { join, dirname, basename, isInside, rebase, validateName } from "../utils/path";

export function detectLanguage(fileName: string): string {
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
  const [workspacePath, setWorkspacePath] = useState<string>("");
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [splitActiveFilePath, setSplitActiveFilePath] = useState<string | null>(null);
  const [isSplit, setIsSplit] = useState<boolean>(false);

  // Folder and directory cache lifted to store for consistency
  const [dirCache, setDirCache] = useState<Map<string, FileEntry[]>>(new Map());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

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
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [showWelcomeOnStartup, setShowWelcomeOnStartup] = useState<boolean>(true);

  // Tools & Settings
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [settings, setSettings] = useState<UserSettings>({
    theme: "dark",
    fontSize: 14,
    tabWidth: 4,
    runTimeoutSecs: 30,
    recentFolders: [],
    showWelcomeOnStartup: true,
  });

  // Single-flight PTY session promise ref
  const [ptySessionId, setPtySessionId] = useState<string | null>(null);
  const pendingPtyPromiseRef = useRef<Promise<string> | null>(null);

  // Live ref for openFiles to avoid stale closures
  const openFilesRef = useRef<OpenFile[]>(openFiles);
  openFilesRef.current = openFiles;

  const activeFilePathRef = useRef<string | null>(activeFilePath);
  activeFilePathRef.current = activeFilePath;

  // Load initial settings and toolchains with existence check on lastFolder
  useEffect(() => {
    settingsService.loadSettings().then(async (s) => {
      setSettings(s);
      if (s.recentFolders && s.recentFolders.length > 0) {
        setRecentFolders(s.recentFolders);
      }
      if (s.showWelcomeOnStartup !== undefined) {
        setShowWelcomeOnStartup(s.showWelcomeOnStartup);
        setIsWelcomeOpen(s.showWelcomeOnStartup);
      }

      if (s.lastFolder) {
        try {
          const exists = await fsService.exists(s.lastFolder);
          if (exists) {
            setWorkspacePath(s.lastFolder);
            setIsWelcomeOpen(false);
          } else {
            notify.info("Workspace", "Last folder is no longer available.");
            settingsService.saveSettings({ ...s, lastFolder: undefined });
          }
        } catch {
          notify.info("Workspace", "Last folder is no longer available.");
        }
      }
    });

    envService.detectTools().then(setTools);
  }, []);

  // Refresh a directory's contents
  const refreshDir = useCallback(async (dirPath: string) => {
    if (!dirPath) return;
    try {
      const entries = await fsService.listDir(dirPath);
      setDirCache((prev) => new Map(prev).set(dirPath, entries));
      if (dirPath === workspacePath) {
        setFileTree(entries);
      }
    } catch (err) {
      console.error("Failed to list dir:", err);
    }
  }, [workspacePath]);

  // Refresh entire explorer including workspace root
  const refreshExplorer = useCallback(async () => {
    if (!workspacePath) {
      setFileTree([]);
      setDirCache(new Map());
      return;
    }
    await refreshDir(workspacePath);
  }, [workspacePath, refreshDir]);

  useEffect(() => {
    refreshExplorer();
  }, [refreshExplorer]);

  // Toggle subfolder expansion
  const toggleFolder = useCallback(
    async (folderPath: string) => {
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) {
          next.delete(folderPath);
        } else {
          next.add(folderPath);
        }
        return next;
      });

      if (!dirCache.has(folderPath)) {
        setLoadingFolders((prev) => new Set(prev).add(folderPath));
        try {
          const entries = await fsService.listDir(folderPath);
          setDirCache((prev) => new Map(prev).set(folderPath, entries));
        } catch (err) {
          notify.error("Folder Error", formatError(err));
        } finally {
          setLoadingFolders((prev) => {
            const next = new Set(prev);
            next.delete(folderPath);
            return next;
          });
        }
      }
    },
    [dirCache]
  );

  // Open file into tabs
  const openFileByPath = useCallback(
    async (path: string, name?: string) => {
      const existing = openFilesRef.current.find((f) => f.path === path);
      if (existing) {
        setActiveFilePath(path);
        editorService.focusActive();
        return;
      }

      try {
        const fileName = name || basename(path) || "untitled";
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
        editorService.focusActive();
      } catch (err) {
        console.error("Failed to open file:", err);
        notify.error("File Open Error", formatError(err));
      }
    },
    []
  );

  // Close file tab and dispose model
  const closeFile = useCallback(
    (path: string) => {
      editorService.disposeModel(path);
      setOpenFiles((prev) => {
        const next = prev.filter((f) => f.path !== path);
        if (activeFilePathRef.current === path) {
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
    [splitActiveFilePath]
  );

  // Close all other tabs
  const closeOtherFiles = useCallback((path: string) => {
    for (const f of openFilesRef.current) {
      if (f.path !== path) {
        editorService.disposeModel(f.path);
      }
    }
    setOpenFiles((prev) => prev.filter((f) => f.path === path));
    setActiveFilePath(path);
  }, []);

  // Update file content in memory (marks dirty)
  const updateFileContent = useCallback((path: string, _content: string) => {
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path === path) {
          if (f.isDirty) return f;
          return { ...f, isDirty: true };
        }
        return f;
      })
    );
  }, []);

  // Save file to disk reading from model-as-truth
  const saveFile = useCallback(
    async (path: string) => {
      const target = openFilesRef.current.find((f) => f.path === path);
      if (!target) return;
      try {
        const contentToSave = editorService.getText(path) ?? target.content;
        await fsService.writeFile(path, contentToSave);
        const language = detectLanguage(target.name);
        setOpenFiles((prev) =>
          prev.map((f) => (f.path === path ? { ...f, content: contentToSave, isDirty: false, language } : f))
        );
      } catch (err) {
        console.error("Failed to save file:", err);
        notify.error("Save Error", formatError(err));
      }
    },
    []
  );

  // Save active file
  const saveActiveFile = useCallback(() => {
    if (activeFilePathRef.current) {
      saveFile(activeFilePathRef.current);
    }
  }, [saveFile]);

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
    for (const f of openFilesRef.current) {
      editorService.disposeModel(f.path);
    }
    setOpenFiles([]);
    setActiveFilePath(null);
    setSplitActiveFilePath(null);
    setIsWelcomeOpen(true);
  }, []);

  const switchToNextTab = useCallback(() => {
    const files = openFilesRef.current;
    if (files.length === 0) return;
    const currentIdx = files.findIndex((f) => f.path === activeFilePathRef.current);
    const nextIdx = (currentIdx + 1) % files.length;
    setActiveFilePath(files[nextIdx].path);
    editorService.focusActive();
  }, []);

  const switchToPrevTab = useCallback(() => {
    const files = openFilesRef.current;
    if (files.length === 0) return;
    const currentIdx = files.findIndex((f) => f.path === activeFilePathRef.current);
    const prevIdx = (currentIdx - 1 + files.length) % files.length;
    setActiveFilePath(files[prevIdx].path);
    editorService.focusActive();
  }, []);

  // Create new entry (file or folder) at any depth
  const createEntry = useCallback(
    async (parentDir: string, name: string, isDir: boolean) => {
      const err = validateName(name);
      if (err) {
        notify.error("Invalid Name", err);
        return;
      }

      const fullPath = join(parentDir, name);
      try {
        if (isDir) {
          await fsService.createDir(fullPath);
          await refreshDir(parentDir);
          setExpandedFolders((prev) => new Set(prev).add(parentDir));
        } else {
          await fsService.createFile(fullPath);
          await refreshDir(parentDir);
          await openFileByPath(fullPath, name);
        }
      } catch (e) {
        notify.error(isDir ? "Folder Creation Failed" : "File Creation Failed", formatError(e));
      }
    },
    [refreshDir, openFileByPath]
  );

  // Rename entry (file or folder) at any depth with tab synchronization
  const renameEntry = useCallback(
    async (oldPath: string, newName: string) => {
      const err = validateName(newName);
      if (err) {
        notify.error("Invalid Name", err);
        return;
      }

      const parentDir = dirname(oldPath);
      const newPath = join(parentDir, newName);
      try {
        await fsService.renameFile(oldPath, newPath);

        // Invalidate directory cache
        await refreshDir(parentDir);
        setDirCache((prev) => {
          const next = new Map(prev);
          for (const k of next.keys()) {
            if (isInside(k, oldPath)) next.delete(k);
          }
          return next;
        });

        // Rebase open tabs preserving unsaved dirty edits
        setOpenFiles((prev) =>
          prev.map((tab) => {
            if (tab.path === oldPath || isInside(tab.path, oldPath)) {
              const liveText = editorService.getText(tab.path) ?? tab.content;
              editorService.disposeModel(tab.path);
              const rebasedPath = rebase(tab.path, oldPath, newPath);
              const rebasedName = basename(rebasedPath);
              const language = detectLanguage(rebasedName);
              return {
                ...tab,
                path: rebasedPath,
                name: rebasedName,
                content: liveText,
                language,
              };
            }
            return tab;
          })
        );

        // Rebase active file paths
        if (activeFilePathRef.current && (activeFilePathRef.current === oldPath || isInside(activeFilePathRef.current, oldPath))) {
          setActiveFilePath(rebase(activeFilePathRef.current, oldPath, newPath));
        }
        if (splitActiveFilePath && (splitActiveFilePath === oldPath || isInside(splitActiveFilePath, oldPath))) {
          setSplitActiveFilePath(rebase(splitActiveFilePath, oldPath, newPath));
        }
      } catch (e) {
        notify.error("Rename Failed", formatError(e));
      }
    },
    [refreshDir, splitActiveFilePath]
  );

  // Delete entry (file or folder) at any depth with descendant tab closing
  const deleteEntry = useCallback(
    async (path: string) => {
      try {
        await fsService.deleteFile(path);
        const parentDir = dirname(path);
        await refreshDir(parentDir);

        // Invalidate directory cache
        setDirCache((prev) => {
          const next = new Map(prev);
          for (const k of next.keys()) {
            if (isInside(k, path)) next.delete(k);
          }
          return next;
        });

        // Close all tabs for this file or any file inside this deleted folder
        for (const tab of openFilesRef.current) {
          if (tab.path === path || isInside(tab.path, path)) {
            editorService.disposeModel(tab.path);
          }
        }

        setOpenFiles((prev) => {
          const remaining = prev.filter((f) => f.path !== path && !isInside(f.path, path));
          if (activeFilePathRef.current && (activeFilePathRef.current === path || isInside(activeFilePathRef.current, path))) {
            setActiveFilePath(remaining[0]?.path || null);
          }
          if (splitActiveFilePath && (splitActiveFilePath === path || isInside(splitActiveFilePath, path))) {
            setSplitActiveFilePath(remaining[0]?.path || null);
          }
          return remaining;
        });
      } catch (e) {
        notify.error("Delete Failed", formatError(e));
      }
    },
    [refreshDir, splitActiveFilePath]
  );

  // Backward compatible creation wrappers for root
  const createNewFile = useCallback(
    async (fileName: string) => {
      if (!workspacePath) return;
      await createEntry(workspacePath, fileName, false);
    },
    [workspacePath, createEntry]
  );

  const createNewFolder = useCallback(
    async (folderName: string) => {
      if (!workspacePath) return;
      await createEntry(workspacePath, folderName, true);
    },
    [workspacePath, createEntry]
  );

  const deletePath = useCallback(
    async (path: string) => {
      await deleteEntry(path);
    },
    [deleteEntry]
  );

  const renamePath = useCallback(
    async (oldPath: string, newPath: string) => {
      const newName = basename(newPath);
      await renameEntry(oldPath, newName);
    },
    [renameEntry]
  );

  // Ensure single-flight PTY session (F3 race resolution)
  const ensurePtySession = useCallback(async (preferredId?: string): Promise<string> => {
    if (ptySessionId) return ptySessionId;
    if (pendingPtyPromiseRef.current) return pendingPtyPromiseRef.current;

    pendingPtyPromiseRef.current = (async () => {
      try {
        const id = preferredId || "pty-" + Math.random().toString(36).substring(2, 10);
        const spawnedId = await ptyService.spawnPty({ sessionId: id, cwd: workspacePath || undefined });
        const finalId = spawnedId || id;
        setPtySessionId(finalId);
        return finalId;
      } catch (err) {
        console.error("Failed to spawn PTY:", err);
        return "";
      } finally {
        pendingPtyPromiseRef.current = null;
      }
    })();

    return pendingPtyPromiseRef.current;
  }, [ptySessionId, workspacePath]);

  // Unified Run Engine: Authoritative Rust Runner Pipeline with PTY & Diagnostics
  const runActiveFile = useCallback(async () => {
    const active = openFilesRef.current.find((f) => f.path === activeFilePathRef.current);
    if (!active) return;

    // 1. Auto-save active file using latest model text
    await saveFile(active.path);

    // 2. HTML files automatically switch to Live Preview
    if (active.language === "html") {
      setPanelVisible(true);
      setActivePanelTab("preview");
      return;
    }

    // 3. Clear previous compiler markers on active file
    editorService.clearMarkers(active.path);

    // 4. Open terminal panel
    setPanelVisible(true);
    setActivePanelTab("terminal");

    // 5. Generate run ID
    const runId = "run-" + Math.random().toString(36).substring(2, 10);
    let compileStderr = "";

    // Stream listeners: capture stderr for Monaco squiggles and handle global notifications
    const unOutput = await processService.onRunOutput(runId, (chunk) => {
      if (chunk.stream === "stderr") {
        compileStderr += chunk.chunk;
      }
    });

    const unStatus = await processService.onRunStatus(runId, (status) => {
      if (status.phase === "compileFailed") {
        // Parse compiler errors and attach red squiggles in Monaco
        const diagnostics = parseCompilerDiagnostics(active.language, compileStderr, active.path);
        if (diagnostics.length > 0) {
          editorService.setMarkers(active.path, diagnostics);
        }
        unOutput();
        unStatus();
      } else if (status.phase === "finished") {
        unOutput();
        unStatus();
      } else if (status.phase === "failed") {
        notify.error("Run Error", status.message);
        unOutput();
        unStatus();
      }
    });

    // 6. Notify TerminalPanel to bind to this run in the dedicated Run tab
    window.dispatchEvent(
      new CustomEvent("codeui-run-start", {
        detail: {
          runId,
          name: active.name,
          language: active.language,
          path: active.path,
        },
      })
    );

    // 7. Invoke Rust supervised runner (executes in its own dedicated PTY, completely separate from shell)
    try {
      await processService.runFile(active.path, runId, settings.runTimeoutSecs);
    } catch (err: any) {
      notify.error("Run Error", formatError(err));
      unOutput();
      unStatus();
    }
  }, [saveFile, settings.runTimeoutSecs]);

  return {
    workspacePath,
    fileTree,
    openFiles,
    activeFilePath,
    splitActiveFilePath,
    isSplit,
    dirCache,
    expandedFolders,
    loadingFolders,
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
    createEntry,
    renameEntry,
    deleteEntry,
    toggleFolder,
    refreshDir,
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
