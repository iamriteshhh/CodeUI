import React, { useState } from "react";
import {
  Folder,
  FileCode,
  FilePlus,
  FolderPlus,
  RotateCw,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  Coffee,
  Globe,
  FileType,
} from "lucide-react";
import { FileEntry } from "../../types";

interface FileTreeProps {
  workspacePath: string;
  entries: FileEntry[];
  activeFilePath: string | null;
  onOpenFile: (path: string, name?: string) => void;
  onCreateFile: (name: string) => void;
  onCreateFolder: (name: string) => void;
  onRefresh: () => void;
  onDeletePath: (path: string) => void;
  onRenamePath: (oldPath: string, newPath: string) => void;
  onOpenFolderDialog: () => void;
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "java":
      return <Coffee size={14} color="#e76f51" />;
    case "py":
      return <FileCode size={14} color="#ffd166" />;
    case "c":
    case "cpp":
    case "h":
      return <FileCode size={14} color="#457b9d" />;
    case "html":
    case "htm":
      return <Globe size={14} color="#f77f00" />;
    case "css":
      return <FileType size={14} color="#4ea8de" />;
    case "js":
    case "ts":
      return <FileCode size={14} color="#f4d35e" />;
    default:
      return <FileCode size={14} color="#a8dadc" />;
  }
}

export const FileTree: React.FC<FileTreeProps> = ({
  workspacePath,
  entries,
  activeFilePath,
  onOpenFile,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onDeletePath,
  onRenamePath,
  onOpenFolderDialog,
}) => {
  const [isFolderExpanded, setIsFolderExpanded] = useState(true);
  const [outlineExpanded, setOutlineExpanded] = useState(false);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [creatingType, setCreatingType] = useState<"file" | "folder" | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const folderName = workspacePath.split(/[/\\]/).filter(Boolean).pop() || "WORKSPACE";

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim()) {
      setCreatingType(null);
      return;
    }
    if (creatingType === "file") {
      onCreateFile(newItemName.trim());
    } else {
      onCreateFolder(newItemName.trim());
    }
    setNewItemName("");
    setCreatingType(null);
  };

  const handleRenameSubmit = (oldPath: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const separator = oldPath.includes("\\") ? "\\" : "/";
    const dir = oldPath.substring(0, oldPath.lastIndexOf(separator));
    const newPath = `${dir}${separator}${renameValue.trim()}`;
    onRenamePath(oldPath, newPath);
    setRenamingPath(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Workspace Header Row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          cursor: "pointer",
          backgroundColor: "#202020",
          borderBottom: "1px solid #2d2d2d",
        }}
      >
        <div
          onClick={() => setIsFolderExpanded(!isFolderExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            fontSize: 11,
            color: "#e0e0e0",
            textTransform: "uppercase",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {isFolderExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{folderName}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            className="icon-btn"
            title="New File"
            onClick={(e) => {
              e.stopPropagation();
              setCreatingType("file");
            }}
          >
            <FilePlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="New Folder"
            onClick={(e) => {
              e.stopPropagation();
              setCreatingType("folder");
            }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Refresh Explorer"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
          >
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      {/* Files List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {isFolderExpanded && (
          <>
            {/* Inline creation input */}
            {creatingType && (
              <form
                onSubmit={handleCreateSubmit}
                style={{ padding: "3px 12px 3px 28px" }}
              >
                <input
                  autoFocus
                  type="text"
                  placeholder={
                    creatingType === "file" ? "file.java" : "folder-name"
                  }
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  onBlur={() => setCreatingType(null)}
                  style={{
                    width: "100%",
                    background: "#3c3c3c",
                    border: "1px solid #007acc",
                    color: "#fff",
                    padding: "2px 6px",
                    fontSize: 12,
                    borderRadius: 2,
                  }}
                />
              </form>
            )}

            {entries.length === 0 ? (
              <div
                style={{
                  padding: "16px 20px",
                  color: "#888",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                <p>No files in this folder.</p>
                <button
                  onClick={onOpenFolderDialog}
                  style={{
                    marginTop: 10,
                    background: "#007acc",
                    color: "#fff",
                    border: "none",
                    padding: "4px 10px",
                    borderRadius: 3,
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  Open Folder
                </button>
              </div>
            ) : (
              entries.map((entry) => {
                const isActive = activeFilePath === entry.path;
                const isRenaming = renamingPath === entry.path;

                return (
                  <div
                    key={entry.path}
                    onClick={() => {
                      if (!entry.is_dir) {
                        onOpenFile(entry.path, entry.name);
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "4px 12px 4px 22px",
                      cursor: "pointer",
                      backgroundColor: isActive ? "#37373d" : "transparent",
                      color: isActive ? "#ffffff" : "#cccccc",
                      fontSize: 13,
                    }}
                    className="file-tree-item"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {entry.is_dir ? (
                        <Folder size={14} color="#dcb67a" />
                      ) : (
                        getFileIcon(entry.name)
                      )}

                      {isRenaming ? (
                        <form
                          onSubmit={(e) => handleRenameSubmit(entry.path, e)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ flex: 1 }}
                        >
                          <input
                            autoFocus
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => setRenamingPath(null)}
                            style={{
                              width: "100%",
                              background: "#3c3c3c",
                              border: "1px solid #007acc",
                              color: "#fff",
                              padding: "1px 4px",
                              fontSize: 12,
                            }}
                          />
                        </form>
                      ) : (
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                          {entry.name}
                        </span>
                      )}
                    </div>

                    {!isRenaming && (
                      <div
                        className="file-actions"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          opacity: 0.7,
                        }}
                      >
                        <button
                          className="icon-btn"
                          title="Rename"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingPath(entry.path);
                            setRenameValue(entry.name);
                          }}
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              confirm(
                                `Permanently delete "${entry.name}"? This action cannot be undone.`
                              )
                            ) {
                              onDeletePath(entry.path);
                            }
                          }}
                        >
                          <Trash2 size={12} color="#f14c4c" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* Bottom Collapsible Sections (Screenshot parity) */}
      <div style={{ borderTop: "1px solid #2d2d2d", flexShrink: 0 }}>
        <div
          onClick={() => setOutlineExpanded(!outlineExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            fontSize: 11,
            color: "#8c8c8c",
            cursor: "pointer",
            fontWeight: 600,
            borderBottom: outlineExpanded ? "1px solid #2d2d2d" : "none",
          }}
        >
          {outlineExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>OUTLINE</span>
        </div>
        {outlineExpanded && (
          <div style={{ padding: "8px 16px", color: "#666", fontSize: 12 }}>
            No symbols found in current document.
          </div>
        )}

        <div
          onClick={() => setTimelineExpanded(!timelineExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 12px",
            fontSize: 11,
            color: "#8c8c8c",
            cursor: "pointer",
            fontWeight: 600,
            borderTop: "1px solid #2d2d2d",
          }}
        >
          {timelineExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>TIMELINE</span>
        </div>
        {timelineExpanded && (
          <div style={{ padding: "8px 16px", color: "#666", fontSize: 12 }}>
            File history tracking active.
          </div>
        )}
      </div>
    </div>
  );
};
