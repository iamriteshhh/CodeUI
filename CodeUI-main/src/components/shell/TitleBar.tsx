import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Search,
  PanelLeft,
  Maximize2,
  Minus,
  X,
  Sliders,
  FolderOpen,
  ExternalLink,
  FilePlus,
  FileCode,
  Save,
  RotateCcw,
  RotateCw,
  Scissors,
  Copy,
  Clipboard,
  SearchCode,
  Replace,
  Play,
  Terminal,
  Info,
  Layers,
} from "lucide-react";
import { editorService } from "../../services/editorService";
import { copyDiagnosticsToClipboard } from "../../services/diagnostics";
import { notify } from "../../services/notify";
import codeuiLogo from "../../assets/codeui-logo.png";

interface MenuItemDef {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  divider?: boolean;
  action?: () => void;
}

interface TitleBarProps {
  workspaceTitle: string;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  panelVisible: boolean;
  onTogglePanel: () => void;
  onNewFile?: () => void;
  onOpenFile?: () => void;
  onOpenFolder?: () => void;
  onOpenInFileManager?: () => void;
  onSave?: () => void;
  onCloseActiveFile?: () => void;
  onCloseAllFiles?: () => void;
  onSelectSidebarTab?: (tab: "explorer" | "extensions" | "search") => void;
  onToggleSplit?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  onRunFile?: () => void;
  onRefreshTools?: () => void;
  onNewTerminal?: () => void;
  onOpenWelcome?: () => void;
  onOpenQuickOpen?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  workspaceTitle,
  sidebarVisible,
  onToggleSidebar,
  panelVisible,
  onTogglePanel,
  onNewFile,
  onOpenFile,
  onOpenFolder,
  onOpenInFileManager,
  onSave,
  onCloseActiveFile,
  onCloseAllFiles,
  onSelectSidebarTab,
  onToggleSplit,
  onNextTab,
  onPrevTab,
  onRunFile,
  onRefreshTools,
  onNewTerminal,
  onOpenWelcome,
  onOpenQuickOpen,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // Handle window dragging on mousedown for the titlebar background
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    // Only drag if clicking directly on the titlebar background (not on buttons/menus/inputs)
    const target = e.target as HTMLElement;
    const isInteractive = target.closest('button, input, .menu-item, .titlebar-dropdown, .titlebar-logo, .titlebar-search, .titlebar-action-btn, .titlebar-window-btn, .titlebar-window-controls');
    if (isInteractive) return;
    
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().startDragging();
      } catch (e) {
        console.warn("Drag window error:", e);
      }
    }
  }, []);

  const handleMinimize = async () => {
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().minimize();
      } catch (e) {
        console.warn("Minimize window error:", e);
      }
    }
  };

  const handleToggleMaximize = async () => {
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().toggleMaximize();
      } catch (e) {
        console.warn("Maximize window error:", e);
      }
    }
  };

  const handleClose = async () => {
    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      } catch (e) {
        console.warn("Close window error:", e);
      }
    }
  };

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setOpenMenu(null);
      }
    };
    if (openMenu !== null) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [openMenu]);

  const handleMenuClick = (name: string) => {
    setOpenMenu(openMenu === name ? null : name);
  };

  const handleMenuHover = (name: string) => {
    if (openMenu !== null) {
      setOpenMenu(name);
    }
  };

  const executeAction = (action?: () => void) => {
    setOpenMenu(null);
    if (action) {
      action();
    }
  };

  // Menu Definitions
  const menus: Record<string, MenuItemDef[]> = {
    File: [
      { label: "New File...", shortcut: "Ctrl+N", icon: <FilePlus size={14} />, action: onNewFile },
      { label: "Open File...", shortcut: "Ctrl+O", icon: <FileCode size={14} />, action: onOpenFile },
      { label: "Open Folder...", shortcut: "Ctrl+K Ctrl+O", icon: <FolderOpen size={14} />, action: onOpenFolder },
      { label: "Reveal in File Explorer", icon: <ExternalLink size={14} />, action: onOpenInFileManager },
      { divider: true, label: "" },
      { label: "Save", shortcut: "Ctrl+S", icon: <Save size={14} />, action: onSave },
      { label: "Close Editor", shortcut: "Ctrl+W", action: onCloseActiveFile },
      { label: "Close All Editors", action: onCloseAllFiles },
    ],
    Edit: [
      { label: "Undo", shortcut: "Ctrl+Z", icon: <RotateCcw size={14} />, action: () => editorService.undo() },
      { label: "Redo", shortcut: "Ctrl+Y", icon: <RotateCw size={14} />, action: () => editorService.redo() },
      { divider: true, label: "" },
      { label: "Cut", shortcut: "Ctrl+X", icon: <Scissors size={14} />, action: () => editorService.cut() },
      { label: "Copy", shortcut: "Ctrl+C", icon: <Copy size={14} />, action: () => editorService.copy() },
      { label: "Paste", shortcut: "Ctrl+V", icon: <Clipboard size={14} />, action: () => editorService.paste() },
      { divider: true, label: "" },
      { label: "Find", shortcut: "Ctrl+F", icon: <SearchCode size={14} />, action: () => editorService.find() },
      { label: "Replace", shortcut: "Ctrl+H", icon: <Replace size={14} />, action: () => editorService.replace() },
    ],
    Selection: [
      { label: "Select All", shortcut: "Ctrl+A", action: () => editorService.selectAll() },
      { divider: true, label: "" },
      { label: "Copy Line Up", shortcut: "Shift+Alt+Up", action: () => editorService.copyLineUp() },
      { label: "Copy Line Down", shortcut: "Shift+Alt+Down", action: () => editorService.copyLineDown() },
    ],
    View: [
      {
        label: "Explorer",
        shortcut: "Ctrl+Shift+E",
        action: () => {
          onSelectSidebarTab?.("explorer");
        },
      },
      {
        label: "Extensions / Tools",
        shortcut: "Ctrl+Shift+X",
        action: () => {
          onSelectSidebarTab?.("extensions");
        },
      },
      {
        label: "Search in Files",
        shortcut: "Ctrl+Shift+F",
        action: () => {
          onSelectSidebarTab?.("search");
        },
      },
      { divider: true, label: "" },
      { label: "Toggle Primary Sidebar", shortcut: "Ctrl+B", action: onToggleSidebar },
      { label: "Toggle Bottom Panel", shortcut: "Ctrl+`", action: onTogglePanel },
      { label: "Toggle Split Editor", shortcut: "Ctrl+\\", action: onToggleSplit },
    ],
    Go: [
      {
        label: "Go to File...",
        shortcut: "Ctrl+P",
        action: () => {
          if (onOpenQuickOpen) {
            onOpenQuickOpen();
          } else if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        },
      },
      { label: "Go to Line...", shortcut: "Ctrl+G", action: () => editorService.gotoLine() },
      { divider: true, label: "" },
      { label: "Next Editor Tab", shortcut: "Ctrl+PageDown", action: onNextTab },
      { label: "Previous Editor Tab", shortcut: "Ctrl+PageUp", action: onPrevTab },
    ],
    Run: [
      { label: "Run Active File", shortcut: "F5", icon: <Play size={14} fill="#4ec9b0" color="#4ec9b0" />, action: onRunFile },
      { divider: true, label: "" },
      { label: "Detect Installed Toolchains", icon: <Layers size={14} />, action: onRefreshTools },
    ],
    Terminal: [
      { label: "New Terminal", shortcut: "Ctrl+Shift+`", icon: <Terminal size={14} />, action: onNewTerminal },
      { label: "Toggle Terminal Panel", shortcut: "Ctrl+`", action: onTogglePanel },
    ],
    Help: [
      {
        label: "Welcome",
        icon: <img src={codeuiLogo} alt="CodeUI" style={{ width: 14, height: 14, objectFit: "contain" }} />,
        action: onOpenWelcome,
      },
      {
        label: "Copy Diagnostics",
        icon: <Clipboard size={14} />,
        action: () => copyDiagnosticsToClipboard(),
      },
      { divider: true, label: "" },
      {
        label: "About CodeUI",
        icon: <Info size={14} />,
        action: () => {
          notify.info(
            "CodeUI v0.1.0",
            "A lab-safe, distraction-free IDE for students & developers. Built with Tauri 2 and Monaco Editor."
          );
        },
      },
    ],
  };

  const menuNames = Object.keys(menus);

  return (
    <div className="titlebar" data-tauri-drag-region onMouseDown={handleDragStart} onDoubleClick={handleToggleMaximize}>
      {/* Logo & Menus */}
      <div className="titlebar-left" ref={menuContainerRef}>
        <div className="titlebar-logo" onClick={onOpenWelcome} style={{ cursor: "pointer" }}>
          <img src={codeuiLogo} alt="CodeUI" style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }} />
          <span>CodeUI</span>
        </div>

        <div className="titlebar-menu">
          {menuNames.map((name) => {
            const isOpen = openMenu === name;
            return (
              <div key={name} style={{ position: "relative" }}>
                <span
                  className={`menu-item ${isOpen ? "active" : ""}`}
                  onClick={() => handleMenuClick(name)}
                  onMouseEnter={() => handleMenuHover(name)}
                  style={{
                    backgroundColor: isOpen ? "rgba(255, 255, 255, 0.15)" : undefined,
                    color: isOpen ? "#ffffff" : undefined,
                    cursor: "pointer",
                  }}
                >
                  {name}
                </span>

                {isOpen && (
                  <div className="titlebar-dropdown">
                    {menus[name].map((item, idx) => {
                      if (item.divider) {
                        return <div key={idx} className="dropdown-divider" />;
                      }
                      return (
                        <div
                          key={idx}
                          className="dropdown-item"
                          onClick={() => executeAction(item.action)}
                        >
                          <span className="dropdown-item-left">
                            {item.icon && <span className="dropdown-item-icon">{item.icon}</span>}
                            <span>{item.label}</span>
                          </span>
                          {item.shortcut && (
                            <span className="dropdown-item-shortcut">{item.shortcut}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Center Search Input */}
      <div className="titlebar-center">
        <div
          className="titlebar-search"
          onClick={onOpenQuickOpen}
          style={{ cursor: "pointer" }}
          title="Quick Open File (Ctrl+P)"
        >
          <Search size={14} />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={workspaceTitle ? `${workspaceTitle} — Quick Open (Ctrl+P)` : "Search files and commands (Ctrl+P)"}
            readOnly
            style={{ cursor: "pointer" }}
          />
          <span className="search-shortcut-badge">Ctrl+P</span>
        </div>
      </div>

      {/* Right Action Icons & Window Controls */}
      <div className="titlebar-right">
        <div className="titlebar-actions">
          <button
            className="titlebar-action-btn"
            title="Toggle Primary Sidebar (Ctrl+B)"
            onClick={onToggleSidebar}
            style={{ color: sidebarVisible ? "#007acc" : undefined }}
          >
            <PanelLeft size={15} />
          </button>
          <button
            className="titlebar-action-btn"
            title="Toggle Bottom Panel (Ctrl+`)"
            onClick={onTogglePanel}
            style={{ color: panelVisible ? "#007acc" : undefined }}
          >
            <Sliders size={15} />
          </button>
        </div>

        {/* Flush Windows / VS Code style window controls */}
        <div className="titlebar-window-controls">
          <button
            className="titlebar-window-btn"
            title="Minimize"
            onClick={handleMinimize}
          >
            <Minus size={14} />
          </button>
          <button
            className="titlebar-window-btn"
            title="Maximize"
            onClick={handleToggleMaximize}
          >
            <Maximize2 size={12} />
          </button>
          <button
            className="titlebar-window-btn close"
            title="Close"
            onClick={handleClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
