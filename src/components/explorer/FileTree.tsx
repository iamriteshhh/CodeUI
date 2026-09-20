import React, { useState, useCallback, useEffect } from "react";
import {
  FilePlus,
  FolderPlus,
  FolderOpen,
  RotateCw,
  Trash2,
  Edit2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ChevronsDownUp,
  Box,
  Hash,
  Loader2,
  Copy,
  SplitSquareVertical,
} from "lucide-react";
import { FileEntry, OpenFile } from "../../types";
import { fsService } from "../../services/fsService";
import { editorService } from "../../services/editorService";
import { FileIcon, FolderIcon } from "../icons/FileIcon";

interface FileTreeProps {
  workspacePath: string;
  entries: FileEntry[];
  activeFilePath: string | null;
  activeFile?: OpenFile;
  onOpenFile: (path: string, name?: string) => void;
  onOpenToSide?: (path: string) => void;
  onCreateFile: (name: string) => void;
  onCreateFolder: (name: string) => void;
  onRefresh: () => void;
  onDeletePath: (path: string) => void;
  onRenamePath: (oldPath: string, newPath: string) => void;
  onOpenFolderDialog: () => void;
  onOpenInFileManager?: () => void;
}

interface OutlineSymbol {
  name: string;
  kind: "class" | "function" | "method";
  line: number;
}

function parseOutline(content: string, language: string): OutlineSymbol[] {
  const symbols: OutlineSymbol[] = [];
  const lines = content.split("\n");

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
      return;
    }

    if (language === "java" || language === "c" || language === "cpp") {
      const classMatch = trimmed.match(/\b(class|interface|enum|struct)\s+([A-Za-z0-9_]+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[2], kind: "class", line: idx + 1 });
        return;
      }
      const methodMatch = trimmed.match(
        /\b(?:public|private|protected|static|final|native|synchronized|async)*\s*([A-Za-z0-9_<>\[\]]+)\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*(?:throws\s+[^{]+)?\{?/
      );
      if (methodMatch && !["if", "for", "while", "switch", "catch"].includes(methodMatch[2])) {
        symbols.push({ name: `${methodMatch[2]}()`, kind: "method", line: idx + 1 });
        return;
      }
    } else if (language === "python") {
      const classMatch = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
      if (classMatch) {
        symbols.push({ name: classMatch[1], kind: "class", line: idx + 1 });
        return;
      }
      const defMatch = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(/);
      if (defMatch) {
        symbols.push({ name: `${defMatch[1]}()`, kind: "function", line: idx + 1 });
        return;
      }
    } else {
      const fnMatch = trimmed.match(/\bfunction\s+([A-Za-z0-9_]+)\s*\(/);
      if (fnMatch) {
        symbols.push({ name: `${fnMatch[1]}()`, kind: "function", line: idx + 1 });
      }
    }
  });

  return symbols.slice(0, 30);
}

interface ContextMenuState {
  x: number;
  y: number;
  entry?: FileEntry;
  parentPath?: string;
  isBackground?: boolean;
}

export const FileTree: React.FC<FileTreeProps> = ({
  workspacePath,
  entries,
  activeFilePath,
  activeFile,
  onOpenFile,
  onOpenToSide,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  onDeletePath,
  onRenamePath,
  onOpenFolderDialog,
  onOpenInFileManager,
}) => {
  const [isFolderExpanded, setIsFolderExpanded] = useState(true);
  const [outlineExpanded, setOutlineExpanded] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderContents, setFolderContents] = useState<Map<string, FileEntry[]>>(new Map());
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  // Creation state
  const [creatingUnder, setCreatingUnder] = useState<{ path: string; type: "file" | "folder" } | null>(null);
  const [newItemName, setNewItemName] = useState("");

  // Renaming state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const folderName = workspacePath.split(/[/\\]/).filter(Boolean).pop() || "WORKSPACE";

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleWindowClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setCreatingUnder(null);
        setRenamingPath(null);
      }
    };
    window.addEventListener("click", handleWindowClick);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", handleWindowClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Toggle expand / collapse of a subfolder
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

      if (!folderContents.has(folderPath)) {
        setLoadingFolders((prev) => new Set(prev).add(folderPath));
        try {
          const children = await fsService.listDir(folderPath);
          setFolderContents((prev) => new Map(prev).set(folderPath, children));
        } catch (err) {
          console.error("Failed to load folder children:", err);
        } finally {
          setLoadingFolders((prev) => {
            const next = new Set(prev);
            next.delete(folderPath);
            return next;
          });
        }
      }
    },
    [folderContents]
  );

  // Refresh a single subfolder's cached contents
  const refreshSubfolder = useCallback(async (folderPath: string) => {
    try {
      const children = await fsService.listDir(folderPath);
      setFolderContents((prev) => new Map(prev).set(folderPath, children));
    } catch (err) {
      console.error("Failed to refresh folder:", err);
    }
  }, []);

  // Collapse all folders
  const handleCollapseAll = () => {
    setExpandedFolders(new Set());
  };

  // Submit create item (file or folder)
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!creatingUnder || !newItemName.trim()) {
      setCreatingUnder(null);
      setNewItemName("");
      return;
    }

    const parentPath = creatingUnder.path;
    const type = creatingUnder.type;
    const name = newItemName.trim();
    const separator = parentPath.includes("\\") ? "\\" : "/";
    const fullPath = `${parentPath}${separator}${name}`;

    try {
      if (type === "file") {
        if (parentPath === workspacePath) {
          onCreateFile(name);
        } else {
          await fsService.createFile(fullPath);
          await refreshSubfolder(parentPath);
          onOpenFile(fullPath, name);
        }
      } else {
        if (parentPath === workspacePath) {
          onCreateFolder(name);
        } else {
          await fsService.createDir(fullPath);
          await refreshSubfolder(parentPath);
          setExpandedFolders((prev) => new Set(prev).add(parentPath));
        }
      }
    } catch (err) {
      console.error("Creation error:", err);
    } finally {
      setCreatingUnder(null);
      setNewItemName("");
    }
  };

  // Submit rename
  const handleRenameSubmit = async (oldPath: string, parentPath: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!renameValue.trim()) {
      setRenamingPath(null);
      return;
    }
    const separator = oldPath.includes("\\") ? "\\" : "/";
    const newPath = `${parentPath}${separator}${renameValue.trim()}`;

    try {
      if (parentPath === workspacePath) {
        onRenamePath(oldPath, newPath);
      } else {
        await fsService.renameFile(oldPath, newPath);
        await refreshSubfolder(parentPath);
      }
    } catch (err) {
      console.error("Rename error:", err);
    } finally {
      setRenamingPath(null);
    }
  };

  // Delete item
  const handleDeleteItem = async (path: string, name: string, parentPath: string) => {
    if (confirm(`Permanently delete "${name}"? This action cannot be undone.`)) {
      try {
        if (parentPath === workspacePath) {
          onDeletePath(path);
        } else {
          await fsService.deleteFile(path);
          await refreshSubfolder(parentPath);
        }
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  // Recursive Tree Node Renderer with Tree Indentation Guide Lines
  const renderTreeNodes = (nodes: FileEntry[], parentPath: string, level: number = 0) => {
    return nodes.map((entry) => {
      const isDir = entry.is_dir;
      const isExpanded = expandedFolders.has(entry.path);
      const isLoading = loadingFolders.has(entry.path);
      const children = folderContents.get(entry.path) || [];
      const isActive = activeFilePath === entry.path;
      const isRenaming = renamingPath === entry.path;
      const isCreatingHere = creatingUnder?.path === entry.path;

      return (
        <div key={entry.path} style={{ display: "flex", flexDirection: "column" }}>
          {/* Node Row - Clean, no inline icon clutter */}
          <div
            onClick={() => {
              if (isDir) {
                toggleFolder(entry.path);
              } else {
                onOpenFile(entry.path, entry.name);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                entry,
                parentPath,
              });
            }}
            className="file-tree-item"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 3,
              paddingBottom: 3,
              paddingLeft: level === 0 ? 8 : 4,
              paddingRight: 8,
              cursor: "pointer",
              backgroundColor: isActive ? "#37373d" : "transparent",
              color: isActive ? "#ffffff" : "#cccccc",
              fontSize: 12.5,
              userSelect: "none",
            }}
          >
            {/* Left: Chevron / Folder / File Icon & Name */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {isDir ? (
                <>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      color: "#8c8c8c",
                      width: 14,
                      justifyContent: "center",
                    }}
                  >
                    {isLoading ? (
                      <Loader2 size={11} className="spin" />
                    ) : isExpanded ? (
                      <ChevronDown size={13} />
                    ) : (
                      <ChevronRight size={13} />
                    )}
                  </span>
                  <FolderIcon folderName={entry.name} isExpanded={isExpanded} size={15} />
                </>
              ) : (
                <>
                  <span style={{ width: 14 }} />
                  <FileIcon fileName={entry.name} size={15} />
                </>
              )}

              {isRenaming ? (
                <form
                  onSubmit={(e) => handleRenameSubmit(entry.path, parentPath, e)}
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
                      borderRadius: 2,
                    }}
                  />
                </form>
              ) : (
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontWeight: isDir ? 500 : 400,
                  }}
                >
                  {entry.name}
                </span>
              )}
            </div>
          </div>

          {/* Inline creation input directly under this folder */}
          {isDir && isExpanded && isCreatingHere && (
            <div className="tree-indent-group">
              <div style={{ paddingTop: 2, paddingBottom: 2 }}>
                <form onSubmit={handleCreateSubmit} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {creatingUnder.type === "file" ? (
                    <FileIcon fileName={newItemName || "file.java"} size={14} />
                  ) : (
                    <FolderIcon folderName={newItemName || "folder"} isExpanded={false} size={14} />
                  )}
                  <input
                    autoFocus
                    type="text"
                    placeholder={creatingUnder.type === "file" ? "file.java" : "folder-name"}
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onBlur={() => {
                      if (!newItemName.trim()) setCreatingUnder(null);
                    }}
                    style={{
                      flex: 1,
                      background: "#3c3c3c",
                      border: "1px solid #007acc",
                      color: "#fff",
                      padding: "2px 6px",
                      fontSize: 12,
                      borderRadius: 2,
                    }}
                  />
                </form>
              </div>
            </div>
          )}

          {/* Children nodes if expanded - Wrapped in Tree Indentation Guide Line */}
          {isDir && isExpanded && children.length > 0 && (
            <div className="tree-indent-group">
              {renderTreeNodes(children, entry.path, level + 1)}
            </div>
          )}

          {/* Empty subfolder indicator */}
          {isDir && isExpanded && children.length === 0 && !isLoading && !isCreatingHere && (
            <div className="tree-indent-group">
              <div
                style={{
                  fontSize: 11,
                  color: "#666",
                  paddingTop: 2,
                  paddingBottom: 2,
                }}
              >
                (empty)
              </div>
            </div>
          )}
        </div>
      );
    });
  };

  const outlineSymbols =
    activeFile && activeFile.content ? parseOutline(activeFile.content, activeFile.language) : [];

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
          <FolderIcon folderName={folderName} isExpanded={isFolderExpanded} size={15} />
          <span>{folderName}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <button
            className="icon-btn"
            title="New File (Root)"
            onClick={(e) => {
              e.stopPropagation();
              setCreatingUnder({ path: workspacePath, type: "file" });
              setNewItemName("");
            }}
          >
            <FilePlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="New Folder (Root)"
            onClick={(e) => {
              e.stopPropagation();
              setCreatingUnder({ path: workspacePath, type: "folder" });
              setNewItemName("");
            }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            className="icon-btn"
            title="Collapse All Folders"
            onClick={(e) => {
              e.stopPropagation();
              handleCollapseAll();
            }}
          >
            <ChevronsDownUp size={13} />
          </button>
          <button
            className="icon-btn"
            title="Open Folder (Browse...)"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolderDialog();
            }}
          >
            <FolderOpen size={14} />
          </button>
          {onOpenInFileManager && (
            <button
              className="icon-btn"
              title="Reveal in File Explorer"
              onClick={(e) => {
                e.stopPropagation();
                onOpenInFileManager();
              }}
            >
              <ExternalLink size={13} />
            </button>
          )}
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

      {/* Files Tree Container */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({
            x: e.clientX,
            y: e.clientY,
            isBackground: true,
          });
        }}
      >
        {isFolderExpanded && (
          <>
            {/* Inline creation at root */}
            {creatingUnder?.path === workspacePath && (
              <div style={{ padding: "4px 12px 4px 24px" }}>
                <form onSubmit={handleCreateSubmit} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {creatingUnder.type === "file" ? (
                    <FileIcon fileName={newItemName || "file.java"} size={14} />
                  ) : (
                    <FolderIcon folderName={newItemName || "folder"} isExpanded={false} size={14} />
                  )}
                  <input
                    autoFocus
                    type="text"
                    placeholder={creatingUnder.type === "file" ? "file.java" : "folder-name"}
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onBlur={() => {
                      if (!newItemName.trim()) setCreatingUnder(null);
                    }}
                    style={{
                      flex: 1,
                      background: "#3c3c3c",
                      border: "1px solid #007acc",
                      color: "#fff",
                      padding: "2px 6px",
                      fontSize: 12,
                      borderRadius: 2,
                    }}
                  />
                </form>
              </div>
            )}

            {/* Tree nodes with clean indentation guides */}
            {entries.length > 0 ? (
              renderTreeNodes(entries, workspacePath, 0)
            ) : (
              <div style={{ padding: "20px 16px", textAlign: "center", color: "#777", fontSize: 12 }}>
                <p>No files in workspace</p>
                <button
                  onClick={onOpenFolderDialog}
                  style={{
                    marginTop: 10,
                    background: "#007acc",
                    color: "#fff",
                    border: "none",
                    padding: "4px 10px",
                    borderRadius: 3,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  Open Folder...
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Code Outline Section */}
      <div style={{ borderTop: "1px solid #2d2d2d" }}>
        <div
          onClick={() => setOutlineExpanded(!outlineExpanded)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 12px",
            fontSize: 11,
            fontWeight: 600,
            color: "#8c8c8c",
            cursor: "pointer",
            backgroundColor: "#202020",
          }}
        >
          {outlineExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>OUTLINE</span>
          {activeFile && (
            <span style={{ fontSize: 10, color: "#666", marginLeft: 4 }}>
              ({activeFile.name})
            </span>
          )}
        </div>

        {outlineExpanded && (
          <div style={{ maxHeight: 180, overflowY: "auto", padding: "4px 0" }}>
            {outlineSymbols.length > 0 ? (
              outlineSymbols.map((sym, idx) => (
                <div
                  key={idx}
                  onClick={() => editorService.revealLine(sym.line)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "3px 12px 3px 20px",
                    fontSize: 12,
                    color: "#bbb",
                    cursor: "pointer",
                  }}
                  className="outline-item"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                    {sym.kind === "class" ? (
                      <Box size={13} color="#f4a261" />
                    ) : (
                      <Hash size={13} color="#4ea8de" />
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {sym.name}
                    </span>
                  </div>
                  <span style={{ fontSize: 10, color: "#666" }}>:{sym.line}</span>
                </div>
              ))
            ) : (
              <div style={{ padding: "8px 16px", color: "#666", fontSize: 11 }}>
                {activeFile ? "No symbols detected in current file." : "No file open."}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="file-tree-context-menu"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 250),
            left: Math.min(contextMenu.x, window.innerWidth - 220),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.entry ? (
            contextMenu.entry.is_dir ? (
              <>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    const p = contextMenu.entry!.path;
                    setExpandedFolders((prev) => new Set(prev).add(p));
                    setCreatingUnder({ path: p, type: "file" });
                    setNewItemName("");
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <FilePlus size={14} color="#4ea8de" />
                    <span>New File...</span>
                  </div>
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    const p = contextMenu.entry!.path;
                    setExpandedFolders((prev) => new Set(prev).add(p));
                    setCreatingUnder({ path: p, type: "folder" });
                    setNewItemName("");
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <FolderPlus size={14} color="#dcb67a" />
                    <span>New Folder...</span>
                  </div>
                </div>
                <div className="context-menu-divider" />
                <div
                  className="context-menu-item"
                  onClick={() => {
                    setRenamingPath(contextMenu.entry!.path);
                    setRenameValue(contextMenu.entry!.name);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <Edit2 size={14} />
                    <span>Rename...</span>
                  </div>
                  <span className="context-menu-shortcut">F2</span>
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    handleDeleteItem(
                      contextMenu.entry!.path,
                      contextMenu.entry!.name,
                      contextMenu.parentPath || workspacePath
                    );
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <Trash2 size={14} color="#f14c4c" />
                    <span>Delete</span>
                  </div>
                  <span className="context-menu-shortcut">Del</span>
                </div>
                <div className="context-menu-divider" />
                <div
                  className="context-menu-item"
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.entry!.path);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <Copy size={14} />
                    <span>Copy Path</span>
                  </div>
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    fsService.openInFileManager(contextMenu.entry!.path);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <ExternalLink size={14} />
                    <span>Reveal in File Explorer</span>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    onOpenFile(contextMenu.entry!.path, contextMenu.entry!.name);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <FileIcon fileName={contextMenu.entry!.name} size={14} />
                    <span>Open</span>
                  </div>
                </div>
                {onOpenToSide && (
                  <div
                    className="context-menu-item"
                    onClick={() => {
                      onOpenToSide(contextMenu.entry!.path);
                      setContextMenu(null);
                    }}
                  >
                    <div className="context-menu-item-left">
                      <SplitSquareVertical size={14} />
                      <span>Open to the Side</span>
                    </div>
                    <span className="context-menu-shortcut">Ctrl+\</span>
                  </div>
                )}
                <div className="context-menu-divider" />
                <div
                  className="context-menu-item"
                  onClick={() => {
                    setRenamingPath(contextMenu.entry!.path);
                    setRenameValue(contextMenu.entry!.name);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <Edit2 size={14} />
                    <span>Rename...</span>
                  </div>
                  <span className="context-menu-shortcut">F2</span>
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    handleDeleteItem(
                      contextMenu.entry!.path,
                      contextMenu.entry!.name,
                      contextMenu.parentPath || workspacePath
                    );
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <Trash2 size={14} color="#f14c4c" />
                    <span>Delete</span>
                  </div>
                  <span className="context-menu-shortcut">Del</span>
                </div>
                <div className="context-menu-divider" />
                <div
                  className="context-menu-item"
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.entry!.path);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <Copy size={14} />
                    <span>Copy Path</span>
                  </div>
                </div>
                <div
                  className="context-menu-item"
                  onClick={() => {
                    fsService.openInFileManager(contextMenu.entry!.path);
                    setContextMenu(null);
                  }}
                >
                  <div className="context-menu-item-left">
                    <ExternalLink size={14} />
                    <span>Reveal in File Explorer</span>
                  </div>
                </div>
              </>
            )
          ) : (
            <>
              <div
                className="context-menu-item"
                onClick={() => {
                  setCreatingUnder({ path: workspacePath, type: "file" });
                  setNewItemName("");
                  setContextMenu(null);
                }}
              >
                <div className="context-menu-item-left">
                  <FilePlus size={14} color="#4ea8de" />
                  <span>New File...</span>
                </div>
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  setCreatingUnder({ path: workspacePath, type: "folder" });
                  setNewItemName("");
                  setContextMenu(null);
                }}
              >
                <div className="context-menu-item-left">
                  <FolderPlus size={14} color="#dcb67a" />
                  <span>New Folder...</span>
                </div>
              </div>
              <div className="context-menu-divider" />
              <div
                className="context-menu-item"
                onClick={() => {
                  onRefresh();
                  setContextMenu(null);
                }}
              >
                <div className="context-menu-item-left">
                  <RotateCw size={14} />
                  <span>Refresh Explorer</span>
                </div>
              </div>
              <div
                className="context-menu-item"
                onClick={() => {
                  handleCollapseAll();
                  setContextMenu(null);
                }}
              >
                <div className="context-menu-item-left">
                  <ChevronsDownUp size={14} />
                  <span>Collapse All Folders</span>
                </div>
              </div>
              {onOpenInFileManager && (
                <>
                  <div className="context-menu-divider" />
                  <div
                    className="context-menu-item"
                    onClick={() => {
                      onOpenInFileManager();
                      setContextMenu(null);
                    }}
                  >
                    <div className="context-menu-item-left">
                      <ExternalLink size={14} />
                      <span>Reveal in File Explorer</span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
