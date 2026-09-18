import { useState, useEffect } from "react";
import { TitleBar } from "./components/shell/TitleBar";
import { ActivityBar } from "./components/shell/ActivityBar";
import { Sidebar } from "./components/shell/Sidebar";
import { RunDebugBar } from "./components/editor/RunDebugBar";
import { SplitEditorContainer } from "./components/editor/SplitEditorContainer";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { PreviewPanel } from "./components/preview/PreviewPanel";
import { StatusBar } from "./components/shell/StatusBar";
import { useWorkspace } from "./store/useWorkspaceStore";
import { X } from "lucide-react";

export function App() {
  const {
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

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S : Save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
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

  const handleOpenFolderDialog = () => {
    const target = prompt("Enter folder path to open:", workspacePath);
    if (target && target.trim()) {
      openFolder(target.trim());
    }
  };

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
              onOpenFile={(path, name) => openFileByPath(path, name)}
              onCreateFile={createNewFile}
              onCreateFolder={createNewFolder}
              onRefreshExplorer={refreshExplorer}
              onDeletePath={deletePath}
              onRenamePath={renamePath}
              onRefreshTools={refreshTools}
              onSendToTerminal={handleSendToTerminal}
              onOpenFolderDialog={handleOpenFolderDialog}
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
            onSelectTab={(path) => setActiveFilePath(path)}
            onCloseTab={(path) => closeFile(path)}
            onRunFile={runActiveFile}
            isSplit={isSplit}
            onToggleSplit={() => setIsSplit(!isSplit)}
            onTogglePreview={() => {
              setPanelVisible(true);
              setActivePanelTab("preview");
            }}
            previewActive={panelVisible && activePanelTab === "preview"}
          />

          {/* Monaco Editor Container (supports split) */}
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <SplitEditorContainer
              isSplit={isSplit}
              openFiles={openFiles}
              activeFilePath={activeFilePath}
              splitActiveFilePath={splitActiveFilePath}
              onChangeContent={updateFileContent}
              onSave={saveFile}
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
      <StatusBar activeFile={activeFile} toolReadyStatus={toolReadyStatus} />
    </div>
  );
}
