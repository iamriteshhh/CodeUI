import {
  Code2,
  Search,
  PanelLeft,
  Maximize2,
  Minus,
  X,
  Sliders,
} from "lucide-react";

interface TitleBarProps {
  workspaceTitle: string;
  sidebarVisible: boolean;
  onToggleSidebar: () => void;
  panelVisible: boolean;
  onTogglePanel: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  workspaceTitle,
  sidebarVisible,
  onToggleSidebar,
  panelVisible,
  onTogglePanel,
}) => {
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-logo">
          <Code2 size={16} color="#007acc" />
          <span>CodeUI</span>
        </div>
        <div className="titlebar-menu">
          <span className="menu-item">File</span>
          <span className="menu-item">Edit</span>
          <span className="menu-item">Selection</span>
          <span className="menu-item">View</span>
          <span className="menu-item">Go</span>
          <span className="menu-item">Run</span>
          <span className="menu-item">Terminal</span>
          <span className="menu-item">Help</span>
        </div>
      </div>

      <div className="titlebar-center">
        <div className="titlebar-search">
          <Search size={14} />
          <input
            type="text"
            placeholder={workspaceTitle || "Search files and commands (Ctrl+P)"}
            readOnly
          />
        </div>
      </div>

      <div className="titlebar-right">
        <button
          className="titlebar-action-btn"
          title="Toggle Primary Sidebar"
          onClick={onToggleSidebar}
          style={{ color: sidebarVisible ? "#007acc" : undefined }}
        >
          <PanelLeft size={15} />
        </button>
        <button
          className="titlebar-action-btn"
          title="Toggle Bottom Panel"
          onClick={onTogglePanel}
          style={{ color: panelVisible ? "#007acc" : undefined }}
        >
          <Sliders size={15} />
        </button>
        <button className="titlebar-action-btn" title="Minimize">
          <Minus size={14} />
        </button>
        <button className="titlebar-action-btn" title="Maximize">
          <Maximize2 size={12} />
        </button>
        <button className="titlebar-action-btn" title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
