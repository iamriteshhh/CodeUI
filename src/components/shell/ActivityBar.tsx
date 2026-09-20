import React from "react";
import { Files, Search, Play, Blocks, Settings } from "lucide-react";

interface ActivityBarProps {
  activeTab: "explorer" | "extensions" | "search" | "run";
  onSelectTab: (tab: "explorer" | "extensions" | "search" | "run") => void;
  sidebarVisible: boolean;
  onOpenSettings?: () => void;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeTab,
  onSelectTab,
  sidebarVisible,
  onOpenSettings,
}) => {
  return (
    <div className="activity-bar">
      <div className="activity-bar-group">
        <button
          className={`activity-btn ${sidebarVisible && activeTab === "explorer" ? "active" : ""}`}
          title="Explorer (Ctrl+Shift+E)"
          onClick={() => onSelectTab("explorer")}
        >
          <Files size={22} />
        </button>
        <button
          className={`activity-btn ${sidebarVisible && activeTab === "search" ? "active" : ""}`}
          title="Search (Ctrl+Shift+F)"
          onClick={() => onSelectTab("search")}
        >
          <Search size={22} />
        </button>
        <button
          className={`activity-btn ${sidebarVisible && activeTab === "run" ? "active" : ""}`}
          title="Run & Debug (Ctrl+Shift+D)"
          onClick={() => onSelectTab("run")}
        >
          <Play size={22} />
        </button>
        <button
          className={`activity-btn ${sidebarVisible && activeTab === "extensions" ? "active" : ""}`}
          title="Extensions / Toolchains (Ctrl+Shift+X)"
          onClick={() => onSelectTab("extensions")}
        >
          <Blocks size={22} />
        </button>
      </div>

      <div className="activity-bar-group">
        <button
          className="activity-btn"
          title="Settings (Ctrl+,)"
          onClick={onOpenSettings}
        >
          <Settings size={22} />
        </button>
      </div>
    </div>
  );
};
