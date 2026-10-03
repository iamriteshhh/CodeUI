import React, { Suspense } from "react";
import { WelcomeView } from "../welcome/WelcomeView";
import { OpenFile, ExtensionItem } from "../../types";

const MonacoEditorGroup = React.lazy(() =>
  import("./MonacoEditorGroup").then((m) => ({ default: m.MonacoEditorGroup }))
);

const ExtensionDetailView = React.lazy(() =>
  import("../extensions/ExtensionDetailView").then((m) => ({
    default: m.ExtensionDetailView,
  }))
);

const EditorFallback = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", width: "100%", color: "#666", fontSize: 13 }}>
    Loading editor...
  </div>
);

interface SplitEditorContainerProps {
  isSplit: boolean;
  openFiles: OpenFile[];
  activeFilePath: string | null;
  splitActiveFilePath: string | null;
  isWelcomeOpen: boolean;
  activeExtension?: ExtensionItem | null;
  onToggleExtensionEnabled?: (id: string) => void;
  onToggleExtensionInstalled?: (id: string) => void;
  recentFolders: string[];
  showOnStartup: boolean;
  onToggleShowOnStartup: (show: boolean) => void;
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenInFileManager: () => void;
  onOpenRecentFolder: (path: string) => void;
  onOpenTerminal: () => void;
  onSelectWalkthrough?: (topic: string) => void;
  onChangeContent: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onMarkersChange?: (errors: number, warnings: number) => void;
}

export const SplitEditorContainer: React.FC<SplitEditorContainerProps> = ({
  isSplit,
  openFiles,
  activeFilePath,
  splitActiveFilePath,
  isWelcomeOpen,
  activeExtension,
  onToggleExtensionEnabled,
  onToggleExtensionInstalled,
  recentFolders,
  showOnStartup,
  onToggleShowOnStartup,
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onOpenInFileManager,
  onOpenRecentFolder,
  onOpenTerminal,
  onSelectWalkthrough,
  onChangeContent,
  onSave,
  onCursorChange,
  onMarkersChange,
}) => {
  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const splitFile =
    openFiles.find((f) => f.path === splitActiveFilePath) || activeFile;

  const isExtensionActive = activeFilePath === "codeui://extension" && activeExtension;

  const showWelcome =
    !isExtensionActive &&
    isWelcomeOpen &&
    (activeFilePath === "codeui://welcome" || (!activeFile && openFiles.length === 0));

  return (
    <div className="editor-workspace" style={{ position: "relative", width: "100%", height: "100%", display: "flex" }}>
      {/* Primary Editor Group Container (always kept mounted to preserve Monaco model state) */}
      <div
        className="editor-group"
        style={{
          display: isExtensionActive || showWelcome ? "none" : "flex",
          flex: 1,
          height: "100%",
          width: "100%",
          overflow: "hidden",
        }}
      >
        <Suspense fallback={<EditorFallback />}>
          <MonacoEditorGroup
            key="primary-editor-group"
            file={activeFile}
            onChangeContent={onChangeContent}
            onSave={onSave}
            onCursorChange={onCursorChange}
            onMarkersChange={onMarkersChange}
          />
        </Suspense>
      </div>

      {/* Extension Detail View overlay when active */}
      {isExtensionActive && (
        <div style={{ flex: 1, height: "100%", width: "100%", overflow: "hidden" }}>
          <Suspense fallback={<EditorFallback />}>
            <ExtensionDetailView
              extension={activeExtension}
              onToggleEnabled={onToggleExtensionEnabled}
              onToggleInstalled={onToggleExtensionInstalled}
            />
          </Suspense>
        </div>
      )}

      {/* Welcome View overlay when active */}
      {showWelcome && (
        <div style={{ flex: 1, height: "100%", width: "100%", overflow: "hidden" }}>
          <WelcomeView
            recentFolders={recentFolders}
            showOnStartup={showOnStartup}
            onToggleShowOnStartup={onToggleShowOnStartup}
            onNewFile={onNewFile}
            onOpenFile={onOpenFile}
            onOpenFolder={onOpenFolder}
            onOpenInFileManager={onOpenInFileManager}
            onOpenRecentFolder={onOpenRecentFolder}
            onOpenTerminal={onOpenTerminal}
            onSelectWalkthrough={onSelectWalkthrough}
          />
        </div>
      )}

      {/* Editor Group 2 (Split Mode) */}
      {isSplit && !isExtensionActive && !showWelcome && (
        <div className="editor-group split-border" style={{ flex: 1, height: "100%", width: "100%", overflow: "hidden" }}>
          <Suspense fallback={<EditorFallback />}>
            <MonacoEditorGroup
              key="split-editor-group"
              file={splitFile}
              onChangeContent={onChangeContent}
              onSave={onSave}
              onCursorChange={onCursorChange}
              onMarkersChange={onMarkersChange}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
};
