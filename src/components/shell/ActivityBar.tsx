import React from "react";
import { Files, Search, Play, Blocks, Settings } from "lucide-react";

interface ActivityBarProps {
  activeTab: "explorer" | "extensions" | "search";
  onSelectTab: (tab: "explorer" | "extensions" | "search") => void;
  sidebarVisible: boolean;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
  activeTab,
  onSelectTab,
  sidebarVisible,
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
          className="activity-btn"
          title="Run & Debug (Ctrl+Shift+D)"
          onClick={() => onSelectTab("explorer")}
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
        <button className="activity-btn" title="Settings (Ctrl+,)">
          <Settings size={22} />
        </button>
      </div>
    </div>
  );
};
