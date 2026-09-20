import { useState, useEffect } from "react";
import { TitleBar } from "./components/shell/TitleBar";
import { ActivityBar } from "./components/shell/ActivityBar";
import { Sidebar } from "./components/shell/Sidebar";
import { RunDebugBar } from "./components/editor/RunDebugBar";
import { SplitEditorContainer } from "./components/editor/SplitEditorContainer";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { PreviewPanel } from "./components/preview/PreviewPanel";
import { StatusBar } from "./components/shell/StatusBar";
import { SettingsModal } from "./components/settings/SettingsModal";
import { QuickOpenModal } from "./components/palette/QuickOpenModal";
import { useWorkspace } from "./store/useWorkspaceStore";
import { fsService } from "./services/fsService";
import { editorService } from "./services/editorService";
import { X, Maximize2, Minimize2 } from "lucide-react";
import { EXTENSIONS_DATA } from "./data/extensionsData";
import { ExtensionItem } from "./types";
import {
  getStoredLiveExtensions,
  syncAllExtensionsLive,
  fetchLiveExtensionDetails,
} from "./services/extensionService";

export function App() {
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
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
    saveActiveFile,
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

  const activeExtension = extensionsList.find((e) => e.id === selectedExtensionId) || null;

  // Initial background sync with live Open VSX registry
  useEffect(() => {
    setIsSyncingExtensions(true);
    syncAllExtensionsLive(extensionsList, (updated) => {
      setExtensionsList(updated);
      setIsSyncingExtensions(false);
    }).catch(() => {
      setIsSyncingExtensions(false);
    });
  }, []);

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
      const { ptyService } = await import("./services/ptyService");
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

  const handleNewFileDialog = async () => {
    const fileName = prompt("Enter new file name (e.g. main.java):", "untitled.java");
    if (fileName && fileName.trim()) {
      await createNewFile(fileName.trim());
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
              onCursorChange={(line, col) => setCursorPos({ line, col })}
              onMarkersChange={(errors, warnings) => {
                setErrorCount(errors);
                setWarningCount(warnings);
              }}
            />
          </div>

          {/* Bottom Panel (Terminal / Preview) */}
          {panelVisible && (
            <>
              {/* Panel vertical resizer */}
              <div
                className={`resizer-y ${isResizingPanel ? "active" : ""}`}
                onMouseDown={() => setIsResizingPanel(true)}
              />
              <div className="bottom-panel" style={{ height: panelHeight }}>
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
                  {activePanelTab === "terminal" ? (
                    <TerminalPanel
                      sessionId={ptySessionId}
                      workspacePath={workspacePath}
                      onEnsureSession={ensurePtySession}
                    />
                  ) : (
                    <PreviewPanel
                      openFiles={openFiles}
                      activeFilePath={activeFilePath}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. Bottom Status Bar */}
      <StatusBar
        activeFile={activeFile}
        toolReadyStatus={toolReadyStatus}
        cursorPos={cursorPos}
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

      {/* 4. Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={updateSettings}
      />

      {/* 5. Quick Open File Palette */}
      <QuickOpenModal
        isOpen={quickOpenVisible}
        workspacePath={workspacePath}
        onClose={() => setQuickOpenVisible(false)}
        onSelectFile={(path, name) => openFileByPath(path, name)}
      />
    </div>
  );
}
