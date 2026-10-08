import React from "react";
import { FileTree } from "../explorer/FileTree";
import { ExtensionsPanel } from "../extensions/ExtensionsPanel";
import { SearchPanel } from "../explorer/SearchPanel";
import { RunPanel } from "../explorer/RunPanel";
import { FileEntry, ToolStatus, OpenFile, ExtensionItem } from "../../types";

interface SidebarProps {
  activeTab: "explorer" | "extensions" | "search" | "run";
  width: number;
  workspacePath: string;
  fileTree: FileEntry[];
  activeFilePath: string | null;
  activeFile?: OpenFile;
  tools: ToolStatus[];
  dirCache?: Map<string, FileEntry[]>;
  expandedFolders?: Set<string>;
  loadingFolders?: Set<string>;
  onToggleFolder?: (path: string) => void;
  onCreateEntry?: (parentDir: string, name: string, isDir: boolean) => Promise<void> | void;
  onRenameEntry?: (oldPath: string, newName: string) => Promise<void> | void;
  onDeleteEntry?: (path: string) => Promise<void> | void;
  onOpenFile: (path: string, name?: string) => void;
  onOpenToSide?: (path: string) => void;
  onCreateFile: (name: string) => void;
  onCreateFolder: (name: string) => void;
  onRefreshExplorer: () => void;
  onDeletePath: (path: string) => void;
  onRenamePath: (oldPath: string, newPath: string) => void;
  onRefreshTools: () => void;
  onSendToTerminal: (command: string) => void;
  onOpenFolderDialog: () => void;
  onCloseFolder?: () => void;
  onOpenInFileManager?: () => void;
  onRunFile?: () => void;
  onSearchSelectResult?: (filePath: string, lineNumber: number) => void;
  runTimeoutSecs: number;
  selectedExtensionId?: string | null;
  extensionsList?: ExtensionItem[];
  isSyncingExtensions?: boolean;
  onSelectExtension?: (id: string, extItem?: ExtensionItem) => void;
  onToggleExtensionInstalled?: (id: string, extItem?: ExtensionItem) => void;
  onRefreshExtensions?: () => void;
  onOpenSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  width,
  workspacePath,
  fileTree,
  activeFilePath,
  activeFile,
  tools,
  dirCache,
  expandedFolders,
  loadingFolders,
  onToggleFolder,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onOpenFile,
  onOpenToSide,
  onCreateFile,
  onCreateFolder,
  onRefreshExplorer,
  onDeletePath,
  onRenamePath,
  onRefreshTools,
  onSendToTerminal,
  onOpenFolderDialog,
  onCloseFolder,
  onOpenInFileManager,
  onRunFile,
  onSearchSelectResult,
  runTimeoutSecs,
  selectedExtensionId,
  extensionsList,
  isSyncingExtensions,
  onSelectExtension,
  onToggleExtensionInstalled,
  onRefreshExtensions,
  onOpenSettings,
}) => {
  const getHeaderTitle = () => {
    switch (activeTab) {
      case "explorer":
        return "Explorer";
      case "search":
        return "Search";
      case "run":
        return "Run & Debug";
      case "extensions":
        return "Extensions";
    }
  };

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <span>{getHeaderTitle()}</span>
      </div>

      <div className="sidebar-content">
        {activeTab === "explorer" && (
          <FileTree
            workspacePath={workspacePath}
            entries={fileTree}
            activeFilePath={activeFilePath}
            activeFile={activeFile}
            dirCache={dirCache}
            expandedFolders={expandedFolders}
            loadingFolders={loadingFolders}
            onToggleFolder={onToggleFolder}
            onCreateEntry={onCreateEntry}
            onRenameEntry={onRenameEntry}
            onDeleteEntry={onDeleteEntry}
            onOpenFile={onOpenFile}
            onOpenToSide={onOpenToSide}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRefresh={onRefreshExplorer}
            onDeletePath={onDeletePath}
            onRenamePath={onRenamePath}
            onOpenFolderDialog={onOpenFolderDialog}
            onCloseFolder={onCloseFolder}
            onOpenInFileManager={onOpenInFileManager}
          />
        )}

        {activeTab === "search" && (
          <SearchPanel
            workspacePath={workspacePath}
            onSelectResult={(filePath, line) => onSearchSelectResult?.(filePath, line)}
          />
        )}

        {activeTab === "run" && (
          <RunPanel
            activeFile={activeFile}
            tools={tools}
            onRunFile={() => onRunFile?.()}
            onRefreshTools={onRefreshTools}
            onOpenTerminal={() => onSendToTerminal("")}
            runTimeoutSecs={runTimeoutSecs}
          />
        )}

        {activeTab === "extensions" && (
          <ExtensionsPanel
            extensions={extensionsList || []}
            tools={tools}
            isSyncing={isSyncingExtensions}
            selectedExtensionId={selectedExtensionId}
            onSelectExtension={(id, ext) => onSelectExtension?.(id, ext)}
            onToggleInstall={(id, ext) => onToggleExtensionInstalled?.(id, ext)}
            onOpenSettings={onOpenSettings}
            onRefresh={onRefreshExtensions || onRefreshTools}
          />
        )}
      </div>
    </div>
  );
};
