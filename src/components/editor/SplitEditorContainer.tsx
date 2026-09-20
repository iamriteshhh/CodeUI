import React from "react";
import { MonacoEditorGroup } from "./MonacoEditorGroup";
import { WelcomeView } from "../welcome/WelcomeView";
import { ExtensionDetailView } from "../extensions/ExtensionDetailView";
import { OpenFile, ExtensionItem } from "../../types";

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

  if (isExtensionActive && !isSplit) {
    return (
      <div className="editor-workspace">
        <ExtensionDetailView
          extension={activeExtension}
          onToggleEnabled={onToggleExtensionEnabled}
          onToggleInstalled={onToggleExtensionInstalled}
        />
      </div>
    );
  }

  if (showWelcome && !isSplit) {
    return (
      <div className="editor-workspace">
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
    );
  }

  return (
    <div className="editor-workspace">
      {/* Editor Group 1 */}
      <div className="editor-group">
        {isExtensionActive ? (
          <ExtensionDetailView
            extension={activeExtension}
            onToggleEnabled={onToggleExtensionEnabled}
            onToggleInstalled={onToggleExtensionInstalled}
          />
        ) : showWelcome ? (
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
        ) : (
          <MonacoEditorGroup
            file={activeFile}
            onChangeContent={onChangeContent}
            onSave={onSave}
            onCursorChange={onCursorChange}
            onMarkersChange={onMarkersChange}
          />
        )}
      </div>

      {/* Editor Group 2 (Split) */}
      {isSplit && (
        <div className="editor-group split-border">
          <MonacoEditorGroup
            file={splitFile}
            onChangeContent={onChangeContent}
            onSave={onSave}
            onCursorChange={onCursorChange}
            onMarkersChange={onMarkersChange}
          />
        </div>
      )}
    </div>
  );
};
