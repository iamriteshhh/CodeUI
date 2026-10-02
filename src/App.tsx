import { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import { TitleBar } from "./components/shell/TitleBar";
import { ActivityBar } from "./components/shell/ActivityBar";
import { Sidebar } from "./components/shell/Sidebar";
import { RunDebugBar } from "./components/editor/RunDebugBar";
import { SplitEditorContainer } from "./components/editor/SplitEditorContainer";
import { StatusBar } from "./components/shell/StatusBar";
import { Toasts } from "./components/shell/Toasts";
import { useWorkspace } from "./store/useWorkspaceStore";
import { fsService } from "./services/fsService";
import { editorService } from "./services/editorService";
import { ptyService } from "./services/ptyService";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { EXTENSIONS_DATA } from "./data/extensionsData";
import { ExtensionItem } from "./types";
import {
  getStoredLiveExtensions,
  syncAllExtensionsLive,
  fetchLiveExtensionDetails,
  isAiExtension,
} from "./services/extensionService";

const TerminalPanel = lazy(() =>
  import("./components/terminal/TerminalPanel").then((m) => ({
    default: m.TerminalPanel,
  }))
);
const PreviewPanel = lazy(() =>
  import("./components/preview/PreviewPanel").then((m) => ({
    default: m.PreviewPanel,
  }))
);
const SettingsModal = lazy(() =>
  import("./components/settings/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  }))
);
const QuickOpenModal = lazy(() =>
  import("./components/palette/QuickOpenModal").then((m) => ({
    default: m.QuickOpenModal,
  }))
);

export function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [tabSize, setTabSize] = useState(4);
  const [isPanelMaximized, setIsPanelMaximized] = useState(false);
  const [extensionsList, setExtensionsList] = useState<ExtensionItem[]>(() => {
    const cached = getStoredLiveExtensions();
    return EXTENSIONS_DATA.map((ext) => {
      const live = cached[ext.id];
      return live ? { ...ext, ...live, installed: ext.installed } : ext;
    });
  });
  const [isSyncingExtensions, setIsSyncingExtensions] = useState(false);
  const [selectedExtensionId, setSelectedExtensionId] = useState<string | null>(null);
  const {
    workspacePath,
    fileTree,
    openFiles,
    activeFilePath,
    splitActiveFilePath,
    setSplitActiveFilePath,
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
    openFolder,
    openFileByPath,
    closeFile,
    updateFileContent,
    saveFile,
    dirCache,
    expandedFolders,
    loadingFolders,
    toggleFolder,
    createEntry,
    renameEntry,
    deleteEntry,
    createNewFile,
    createNewFolder,
    deletePath,
    renamePath,
    refreshExplorer,
    runActiveFile,
    ensurePtySession,
    refreshTools,
  } = useWorkspace();

  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const [newFileModalOpen, setNewFileModalOpen] = useState(false);
  const [newFileNameInput, setNewFileNameInput] = useState("");

  const activeExtension = extensionsList.find((e) => e.id === selectedExtensionId) || null;

  const hasSyncedExtensionsRef = useRef(false);

  // Sync with Open VSX only on-demand when the user views the extensions tab
  useEffect(() => {
    if (sidebarTab === "extensions" && !hasSyncedExtensionsRef.current) {
      hasSyncedExtensionsRef.current = true;
      setIsSyncingExtensions(true);
      syncAllExtensionsLive(extensionsList, (updated) => {
        setExtensionsList(updated);
        setIsSyncingExtensions(false);
      }).catch(() => {
        setIsSyncingExtensions(false);
      });
    }
  }, [sidebarTab]);


  // Synchronize detected system language toolchains with the installed extensions list
  useEffect(() => {
    if (!tools || tools.length === 0) return;

    const findTool = (names: string[]) =>
      tools.find((t) => names.includes(t.name) && t.available);

    setExtensionsList((prev) =>
      prev.map((ext) => {
        let systemTool = null;

        if (ext.id === "ms-python.python") {
          systemTool = findTool(["python", "python3"]);
        } else if (ext.id === "llvm-vs-code-extensions.vscode-clangd") {
          systemTool = findTool(["gcc", "g++", "clang"]);
        } else if (ext.id === "rust-lang.rust-analyzer") {
          systemTool = findTool(["rustc", "cargo"]);
        } else if (ext.id === "golang.go") {
          systemTool = findTool(["go"]);
        } else if (ext.id === "vscjava.vscode-java-pack" || ext.id === "vscjava.vscode-java-debug") {
          systemTool = findTool(["javac", "java"]);
        } else if (ext.id === "eamodio.gitlens") {
          systemTool = findTool(["git"]);
        } else if (ext.id === "ziglang.vscode-zig") {
          systemTool = findTool(["zig"]);
        } else if (ext.id === "salivo.salivo-tools") {
          systemTool = findTool(["sf"]);
        }

        if (systemTool && systemTool.available) {
          return {
            ...ext,
            installed: true,
            systemDetected: true,
            systemToolPath: systemTool.path || "System Path Detected",
          };
        }

        return ext;
      })
    );
  }, [tools]);

  const handleRefreshExtensions = async () => {
    setIsSyncingExtensions(true);
    try {
      await syncAllExtensionsLive(extensionsList, (updated) => {
        setExtensionsList(updated);
      });
    } finally {
      setIsSyncingExtensions(false);
    }
  };

  const handleSelectExtension = async (id: string, extItem?: ExtensionItem) => {
    if (extItem && !extensionsList.some((e) => e.id === id)) {
      setExtensionsList((prev) => [...prev, extItem]);
    }
    setSelectedExtensionId(id);
    setActiveFilePath("codeui://extension");

    const item = extItem || extensionsList.find((e) => e.id === id);
    if (
      item &&
      item.id !== "salivo.salivo-tools" &&
      (!item.overviewMarkdown || item.overviewMarkdown === item.description)
    ) {
      fetchLiveExtensionDetails(id).then((live) => {
        if (live) {
          setExtensionsList((prev) =>
            prev.map((e) => (e.id === id ? { ...e, ...live } : e))
          );
        }
      });
    }
  };

  const handleCloseExtension = () => {
    setSelectedExtensionId(null);
    if (openFiles.length > 0) {
      setActiveFilePath(openFiles[openFiles.length - 1].path);
    } else {
      setActiveFilePath("codeui://welcome");
      setIsWelcomeOpen(true);
    }
  };

  const handleToggleExtensionEnabled = (id: string) => {
    setExtensionsList((prev) =>
      prev.map((ext) => (ext.id === id ? { ...ext, enabled: !ext.enabled } : ext))
    );
  };

  const handleToggleExtensionInstalled = (id: string, extItem?: ExtensionItem) => {
    const item = extItem || extensionsList.find((e) => e.id === id);
    if (item?.blockedByPolicy || (item && isAiExtension(item))) {
      alert("Installation Blocked: AI extensions are restricted by enterprise security policy.");
      return;
    }

    setExtensionsList((prev) => {
      const exists = prev.some((e) => e.id === id);
      if (!exists && extItem) {
        return [...prev, { ...extItem, installed: true }];
      }
      return prev.map((ext) =>
        ext.id === id ? { ...ext, installed: !ext.installed } : ext
      );
    });
  };

  // Send install command into terminal
  const handleSendToTerminal = async (cmd: string) => {
    setPanelVisible(true);
    setActivePanelTab("terminal");
    const sessionId = await ensurePtySession();
    if (sessionId) {
      await ptyService.writePty(sessionId, cmd);
    }
  };

  const handleOpenFolderDialog = async () => {
    try {
      const target = await fsService.pickFolder(workspacePath);
      if (target && target.trim()) {
        openFolder(target.trim());
      }
    } catch (err) {
      console.error("Failed to pick folder:", err);
    }
  };

  const handleOpenFileDialog = async () => {
    try {
      const filePath = await fsService.pickFile(workspacePath);
      if (filePath) {
        await openFileByPath(filePath);
      }
    } catch (err) {
      console.error("Failed to pick file:", err);
    }
  };

  const handleNewFileDialog = () => {
    setNewFileNameInput("");
    setNewFileModalOpen(true);
  };

  const handleConfirmNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newFileNameInput.trim()) {
      setNewFileModalOpen(false);
      await createNewFile(newFileNameInput.trim());
    }
  };

  const handleOpenInFileManager = async () => {
    try {
      await fsService.openInFileManager(workspacePath);
    } catch (err) {
      console.error("Failed to open in file manager:", err);
    }
  };

  const handleNewTerminal = async () => {
    setPanelVisible(true);
    setActivePanelTab("terminal");
    await ensurePtySession();
  };

  const handleCloseActiveFile = () => {
    if (activeFilePath === "codeui://welcome") {
      setIsWelcomeOpen(false);
      setActiveFilePath(openFiles[0]?.path || null);
    } else if (activeFilePath) {
      closeFile(activeFilePath);
      if (openFiles.length <= 1) {
        setIsWelcomeOpen(true);
      }
    }
  };

  const saveActiveFile = useCallback(() => {
    if (activeFilePath && activeFilePath !== "codeui://welcome" && activeFilePath !== "codeui://extension") {
      saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  const handleSelectWelcome = () => {
    setActiveFilePath("codeui://welcome");
  };

  const handleCloseWelcome = () => {
    setIsWelcomeOpen(false);
    if (activeFilePath === "codeui://welcome") {
      setActiveFilePath(openFiles[0]?.path || null);
    }
  };

  const handleOpenWelcome = () => {
    setIsWelcomeOpen(true);
    setActiveFilePath("codeui://welcome");
  };

  const handleWalkthroughSelect = async (topic: string) => {
    if (topic === "java") {
      await createNewFile("Main.java");
    } else if (topic === "python") {
      await createNewFile("main.py");
    } else if (topic === "c-cpp") {
      await createNewFile("main.c");
    } else {
      setSidebarVisible(true);
      setSidebarTab("explorer");
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+, : Settings
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
      // Ctrl+P : Quick Open
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setQuickOpenVisible(true);
      }
      // Ctrl+S : Save
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
      }
      // Ctrl+N : New File
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewFileDialog();
      }
      // Ctrl+O : Open Folder
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleOpenFolderDialog();
      }
      // Ctrl+W : Close File
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        handleCloseActiveFile();
      }
      // Ctrl+` : Toggle Terminal Panel
      else if ((e.ctrlKey || e.metaKey) && e.key === "`") {
        e.preventDefault();
        setPanelVisible(!panelVisible);
        if (!panelVisible) setActivePanelTab("terminal");
      }
      // Ctrl+B : Toggle Sidebar
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarVisible(!sidebarVisible);
      }
      // Ctrl+Shift+E : Explorer
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setSidebarVisible(true);
        setSidebarTab("explorer");
      }
      // Ctrl+Shift+X : Extensions
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        setSidebarVisible(true);
        setSidebarTab("extensions");
      }
      // Ctrl+\ : Split Editor
      else if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
        e.preventDefault();
        setIsSplit(!isSplit);
      }
      // F5 : Run Active File
      else if (e.key === "F5") {
        e.preventDefault();
        runActiveFile();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    saveActiveFile,
    panelVisible,
    setPanelVisible,
    setActivePanelTab,
    sidebarVisible,
    setSidebarVisible,
    setSidebarTab,
    isSplit,
    setIsSplit,
    runActiveFile,
    activeFilePath,
    openFiles,
  ]);

  // Sidebar drag resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingSidebar) {
        const newWidth = Math.max(180, Math.min(600, e.clientX - 48));
        setSidebarWidth(newWidth);
      } else if (isResizingPanel) {
        const newHeight = Math.max(120, Math.min(600, window.innerHeight - e.clientY - 22));
        setPanelHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizingSidebar(false);
      setIsResizingPanel(false);
    };

    if (isResizingSidebar || isResizingPanel) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar, isResizingPanel, setSidebarWidth, setPanelHeight]);

  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const toolReadyStatus = tools.some((t) => t.name === "java" && t.available)
    ? "Java: Ready"
    : tools.some((t) => t.name === "python3" && t.available)
    ? "Python: Ready"
    : "Tools Detected";

  return (
    <div className="app-shell">
      {/* 1. Title/Menu Bar */}
      <TitleBar
        workspaceTitle={workspacePath}
        sidebarVisible={sidebarVisible}
        onToggleSidebar={() => setSidebarVisible(!sidebarVisible)}
        panelVisible={panelVisible}
        onTogglePanel={() => setPanelVisible(!panelVisible)}
        onNewFile={handleNewFileDialog}
        onOpenFile={handleOpenFileDialog}
        onOpenFolder={handleOpenFolderDialog}
        onOpenInFileManager={handleOpenInFileManager}
        onSave={saveActiveFile}
        onCloseActiveFile={handleCloseActiveFile}
        onCloseAllFiles={closeAllFiles}
        onSelectSidebarTab={(tab) => {
          setSidebarVisible(true);
          setSidebarTab(tab);
        }}
        onToggleSplit={() => setIsSplit(!isSplit)}
        onNextTab={switchToNextTab}
        onPrevTab={switchToPrevTab}
        onRunFile={runActiveFile}
        onRefreshTools={refreshTools}
        onNewTerminal={handleNewTerminal}
        onOpenWelcome={handleOpenWelcome}
        onOpenQuickOpen={() => setQuickOpenVisible(true)}
      />

      {/* 2. Middle Body */}
      <div className="app-body">
        {/* Activity Bar */}
        <ActivityBar
          activeTab={sidebarTab}
          onSelectTab={(tab) => {
            if (sidebarVisible && sidebarTab === tab) {
              setSidebarVisible(false);
            } else {
              setSidebarTab(tab);
              setSidebarVisible(true);
            }
          }}
          sidebarVisible={sidebarVisible}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* Sidebar */}
        {sidebarVisible && (
          <>
            <Sidebar
              activeTab={sidebarTab}
              width={sidebarWidth}
              workspacePath={workspacePath}
              fileTree={fileTree}
              activeFilePath={activeFilePath}
              tools={tools}
              activeFile={activeFile}
              dirCache={dirCache}
              expandedFolders={expandedFolders}
              loadingFolders={loadingFolders}
              onToggleFolder={toggleFolder}
              onCreateEntry={createEntry}
              onRenameEntry={renameEntry}
              onDeleteEntry={deleteEntry}
              onOpenFile={(path, name) => openFileByPath(path, name)}
              onOpenToSide={(path) => {
                setSplitActiveFilePath(path);
                setIsSplit(true);
              }}
              onCreateFile={createNewFile}
              onCreateFolder={createNewFolder}
              onRefreshExplorer={refreshExplorer}
              onDeletePath={deletePath}
              onRenamePath={renamePath}
              onRefreshTools={refreshTools}
              onSendToTerminal={handleSendToTerminal}
              onOpenFolderDialog={handleOpenFolderDialog}
              onOpenInFileManager={handleOpenInFileManager}
              onRunFile={runActiveFile}
              selectedExtensionId={selectedExtensionId}
              extensionsList={extensionsList}
              isSyncingExtensions={isSyncingExtensions}
              onSelectExtension={handleSelectExtension}
              onToggleExtensionInstalled={handleToggleExtensionInstalled}
              onRefreshExtensions={handleRefreshExtensions}
              onOpenSettings={() => setSettingsOpen(true)}
              onSearchSelectResult={async (filePath, line) => {
                await openFileByPath(filePath);
                editorService.revealLine(line);
              }}
            />
            {/* Sidebar horizontal resizer */}
            <div
              className={`resizer-x ${isResizingSidebar ? "active" : ""}`}
              onMouseDown={() => setIsResizingSidebar(true)}
            />
          </>
        )}

        {/* Main Area */}
        <div className="main-area">
          {/* Top Run/Debug Bar with Tabs */}
          <RunDebugBar
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            isWelcomeOpen={isWelcomeOpen}
            activeExtension={activeExtension}
            onSelectTab={(path) => setActiveFilePath(path)}
            onCloseTab={(path) => closeFile(path)}
            onSelectWelcome={handleSelectWelcome}
            onCloseWelcome={handleCloseWelcome}
            onSelectExtension={() => setActiveFilePath("codeui://extension")}
            onCloseExtension={handleCloseExtension}
            onRunFile={runActiveFile}
            isSplit={isSplit}
            onToggleSplit={() => setIsSplit(!isSplit)}
            onTogglePreview={() => {
              setPanelVisible(true);
              setActivePanelTab("preview");
            }}
            previewActive={panelVisible && activePanelTab === "preview"}
          />

          {/* Monaco Editor Container (supports split & Welcome screen) */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <SplitEditorContainer
              isSplit={isSplit}
              openFiles={openFiles}
              activeFilePath={activeFilePath}
              splitActiveFilePath={splitActiveFilePath}
              isWelcomeOpen={isWelcomeOpen}
              activeExtension={activeExtension}
              onToggleExtensionEnabled={handleToggleExtensionEnabled}
              onToggleExtensionInstalled={handleToggleExtensionInstalled}
              recentFolders={recentFolders}
              showOnStartup={showWelcomeOnStartup}
              onToggleShowOnStartup={toggleShowWelcomeOnStartup}
              onNewFile={handleNewFileDialog}
              onOpenFile={handleOpenFileDialog}
              onOpenFolder={handleOpenFolderDialog}
              onOpenInFileManager={handleOpenInFileManager}
              onOpenRecentFolder={(folder) => openFolder(folder)}
              onOpenTerminal={handleNewTerminal}
              onSelectWalkthrough={handleWalkthroughSelect}
              onChangeContent={updateFileContent}
              onSave={saveFile}
              onMarkersChange={(errors, warnings) => {
                setErrorCount(errors);
                setWarningCount(warnings);
              }}
            />
          </div>

          {/* Bottom Panel (Terminal / Preview) - kept mounted to preserve xterm session */}
          <>
            {/* Panel vertical resizer */}
            <div
              className={`resizer-y ${isResizingPanel ? "active" : ""}`}
              style={{ display: panelVisible ? "block" : "none" }}
              onMouseDown={() => setIsResizingPanel(true)}
            />
            <div
              className="bottom-panel"
              style={{
                height: panelHeight,
                display: panelVisible ? "flex" : "none",
                flexDirection: "column",
              }}
            >
              <div className="panel-header">
                <div className="panel-tabs">
                  <div
                    className={`panel-tab ${activePanelTab === "terminal" ? "active" : ""}`}
                    onClick={() => setActivePanelTab("terminal")}
                  >
                    Terminal
                  </div>
                  <div
                    className={`panel-tab ${activePanelTab === "preview" ? "active" : ""}`}
                    onClick={() => setActivePanelTab("preview")}
                  >
                    Live Preview
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    className="icon-btn"
                    title={isPanelMaximized ? "Restore Panel Size" : "Maximize Panel Size"}
                    onClick={() => {
                      if (isPanelMaximized) {
                        setPanelHeight(240);
                        setIsPanelMaximized(false);
                      } else {
                        setPanelHeight(Math.min(window.innerHeight * 0.75, 600));
                        setIsPanelMaximized(true);
                      }
                    }}
                  >
                    {isPanelMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                  </button>
                  <button
                    className="icon-btn"
                    title="Close Panel"
                    onClick={() => setPanelVisible(false)}
                  >
                    <X size={13} />
                  </button>
                </div>
              </div>

              <div className="panel-content">
                <div
                  style={{
                    display: activePanelTab === "terminal" ? "flex" : "none",
                    height: "100%",
                    width: "100%",
                  }}
                >
                  <Suspense
                    fallback={
                      <div style={{ padding: "12px", color: "#888", fontSize: "12px" }}>
                        Loading terminal...
                      </div>
                    }
                  >
                    <TerminalPanel
                      sessionId={ptySessionId}
                      workspacePath={workspacePath}
                      onEnsureSession={ensurePtySession}
                    />
                  </Suspense>
                </div>

                <div
                  style={{
                    display: activePanelTab === "preview" ? "flex" : "none",
                    height: "100%",
                    width: "100%",
                  }}
                >
                  <Suspense
                    fallback={
                      <div style={{ padding: "12px", color: "#888", fontSize: "12px" }}>
                        Loading preview...
                      </div>
                    }
                  >
                    <PreviewPanel
                      openFiles={openFiles}
                      activeFilePath={activeFilePath}
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          </>
        </div>
      </div>

      {/* 3. Bottom Status Bar */}
      <StatusBar
        activeFile={activeFile}
        toolReadyStatus={toolReadyStatus}
        errorCount={errorCount}
        warningCount={warningCount}
        tabSize={tabSize}
        onToggleTabSize={() => {
          const next = tabSize === 4 ? 2 : 4;
          setTabSize(next);
          editorService.setTabSize(next);
        }}
        onTogglePanel={() => setPanelVisible(!panelVisible)}
        onOpenExtensions={() => {
          setSidebarVisible(true);
          setSidebarTab("extensions");
        }}
      />

      {/* 4. Settings Modal (lazy mounted on demand) */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={settingsOpen}
            settings={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={updateSettings}
          />
        </Suspense>
      )}

      {/* 5. Quick Open File Palette (lazy mounted on demand) */}
      {quickOpenVisible && (
        <Suspense fallback={null}>
          <QuickOpenModal
            isOpen={quickOpenVisible}
            workspacePath={workspacePath}
            onClose={() => setQuickOpenVisible(false)}
            onSelectFile={(path, name) => openFileByPath(path, name)}
          />
        </Suspense>
      )}

      {/* In-app New File Modal (fixes F11 platform prompt failure) */}
      {newFileModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
          onClick={() => setNewFileModalOpen(false)}
        >
          <div
            style={{
              background: "#252526",
              border: "1px solid #3c3c3c",
              borderRadius: 6,
              padding: 20,
              maxWidth: 380,
              width: "90%",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 12px 0", fontSize: 15, color: "#ffffff" }}>
              New File
            </h3>
            <form onSubmit={handleConfirmNewFile}>
              <input
                autoFocus
                type="text"
                placeholder="e.g. main.py, Main.java, index.c"
                value={newFileNameInput}
                onChange={(e) => setNewFileNameInput(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#3c3c3c",
                  border: "1px solid #555555",
                  color: "#ffffff",
                  padding: "8px 10px",
                  borderRadius: 4,
                  fontSize: 13,
                  marginBottom: 16,
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  style={{
                    background: "#3c3c3c",
                    border: "none",
                    color: "#ffffff",
                    padding: "6px 14px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                  onClick={() => setNewFileModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    background: "#0e639c",
                    border: "none",
                    color: "#ffffff",
                    padding: "6px 14px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Global Notifications / Toasts */}
      <Toasts />
    </div>
  );
}
