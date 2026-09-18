import React from "react";
import { FileTree } from "../explorer/FileTree";
import { ExtensionsPanel } from "../extensions/ExtensionsPanel";
import { FileEntry, ToolStatus } from "../../types";

interface SidebarProps {
  activeTab: "explorer" | "extensions" | "search";
  width: number;
  workspacePath: string;
  fileTree: FileEntry[];
  activeFilePath: string | null;
  tools: ToolStatus[];
  onOpenFile: (path: string, name?: string) => void;
  onCreateFile: (name: string) => void;
  onCreateFolder: (name: string) => void;
  onRefreshExplorer: () => void;
  onDeletePath: (path: string) => void;
  onRenamePath: (oldPath: string, newPath: string) => void;
  onRefreshTools: () => void;
  onSendToTerminal: (command: string) => void;
  onOpenFolderDialog: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  width,
  workspacePath,
  fileTree,
  activeFilePath,
  tools,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRefreshExplorer,
  onDeletePath,
  onRenamePath,
  onRefreshTools,
  onSendToTerminal,
  onOpenFolderDialog,
}) => {
  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-header">
        <span>{activeTab === "explorer" ? "Explorer" : activeTab === "extensions" ? "Extensions" : "Search"}</span>
      </div>

      <div className="sidebar-content">
        {activeTab === "explorer" && (
          <FileTree
            workspacePath={workspacePath}
            entries={fileTree}
            activeFilePath={activeFilePath}
            onOpenFile={onOpenFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRefresh={onRefreshExplorer}
            onDeletePath={onDeletePath}
            onRenamePath={onRenamePath}
            onOpenFolderDialog={onOpenFolderDialog}
          />
        )}

        {activeTab === "extensions" && (
          <ExtensionsPanel
            tools={tools}
            onRefresh={onRefreshTools}
            onSendToTerminal={onSendToTerminal}
          />
        )}

        {activeTab === "search" && (
          <div style={{ padding: "16px 20px", color: "#8c8c8c" }}>
            <p style={{ marginBottom: 8, fontWeight: 500, color: "#ccc" }}>Search in Files</p>
            <input
              type="text"
              placeholder="Search text..."
              style={{
                width: "100%",
                background: "#3c3c3c",
                border: "1px solid #444",
                color: "#fff",
                padding: "4px 8px",
                borderRadius: 3,
                fontSize: 12,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
};
