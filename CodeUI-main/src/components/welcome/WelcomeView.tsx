import React from "react";
import {
  FilePlus,
  FolderOpen,
  FileCode,
  Terminal,
  ExternalLink,
  Star,
  Coffee,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import codeuiLogo from "../../assets/codeui-logo.png";

interface WelcomeViewProps {
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
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
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
}) => {
  // Format folder display name and directory path
  const formatRecent = (folderPath: string) => {
    const parts = folderPath.split(/[/\\]/).filter(Boolean);
    const name = parts[parts.length - 1] || folderPath;
    return { name, path: folderPath };
  };

  const recents = (recentFolders || []).slice(0, 6).map(formatRecent);

  return (
    <div className="welcome-container">
      <div className="welcome-inner">
        {/* Header */}
        <div className="welcome-header">
          <div className="welcome-title-row">
            <img
              src={codeuiLogo}
              alt="CodeUI"
              style={{
                width: 44,
                height: 44,
                objectFit: "contain",
                filter: "drop-shadow(0 4px 16px rgba(0, 122, 204, 0.4))",
              }}
            />
            <h1 className="welcome-title">CodeUI</h1>
          </div>
          <p className="welcome-subtitle">Editing evolved • A lab-safe IDE for students & developers</p>
        </div>

        {/* Main 2-Column Content */}
        <div className="welcome-content">
          {/* Left Column: Start & Recent */}
          <div className="welcome-column">
            {/* Start Section */}
            <div className="welcome-section">
              <h2 className="welcome-section-heading">Start</h2>
              <div className="welcome-action-list">
                <button className="welcome-action-item" onClick={onNewFile}>
                  <FilePlus size={16} color="#3794ff" />
                  <span>New File...</span>
                </button>
                <button className="welcome-action-item" onClick={onOpenFile}>
                  <FileCode size={16} color="#3794ff" />
                  <span>Open File...</span>
                </button>
                <button className="welcome-action-item" onClick={onOpenFolder}>
                  <FolderOpen size={16} color="#3794ff" />
                  <span>Open Folder...</span>
                </button>
                <button className="welcome-action-item" onClick={onOpenInFileManager}>
                  <ExternalLink size={16} color="#3794ff" />
                  <span>Reveal in File Explorer</span>
                </button>
                <button className="welcome-action-item" onClick={onOpenTerminal}>
                  <Terminal size={16} color="#3794ff" />
                  <span>Open Terminal Panel</span>
                </button>
              </div>
            </div>

            {/* Recent Section */}
            <div className="welcome-section" style={{ marginTop: 24 }}>
              <h2 className="welcome-section-heading">Recent</h2>
              <div className="welcome-recent-list">
                {recents.length === 0 ? (
                  <div
                    className="welcome-recent-item"
                    style={{ opacity: 0.6, cursor: "default" }}
                  >
                    <span className="welcome-recent-name">No recent folders</span>
                    <span className="welcome-recent-path">Open a folder to see it here</span>
                  </div>
                ) : (
                  recents.map((item, idx) => (
                    <div
                      key={idx}
                      className="welcome-recent-item"
                      onClick={() => onOpenRecentFolder(item.path)}
                      title={`Open workspace: ${item.path}`}
                    >
                      <span className="welcome-recent-name">{item.name}</span>
                      <span className="welcome-recent-path">{item.path}</span>
                    </div>
                  ))
                )}
                <button className="welcome-more-btn" onClick={onOpenFolder}>
                  More...
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Walkthroughs */}
          <div className="welcome-column">
            <div className="welcome-section">
              <h2 className="welcome-section-heading">Walkthroughs</h2>
              <div className="welcome-walkthroughs-list">
                <div
                  className="welcome-card"
                  onClick={() => onSelectWalkthrough?.("getting-started")}
                >
                  <div className="welcome-card-icon star">
                    <Star size={18} color="#e5c07b" />
                  </div>
                  <div className="welcome-card-body">
                    <div className="welcome-card-title-row">
                      <span className="welcome-card-title">Get started with CodeUI</span>
                    </div>
                    <p className="welcome-card-desc">
                      Customize your editor, learn shortcuts, and start coding in a lab-safe environment.
                    </p>
                  </div>
                </div>

                <div
                  className="welcome-card"
                  onClick={() => onSelectWalkthrough?.("java")}
                >
                  <div className="welcome-card-icon java">
                    <Coffee size={18} color="#e76f51" />
                  </div>
                  <div className="welcome-card-body">
                    <div className="welcome-card-title-row">
                      <span className="welcome-card-title">Get Started with Java Development</span>
                      <span className="welcome-badge">Ready</span>
                    </div>
                    <p className="welcome-card-desc">
                      Single-file compilation & instant execution with auto-detected JDK and terminal runner.
                    </p>
                  </div>
                </div>

                <div
                  className="welcome-card"
                  onClick={() => onSelectWalkthrough?.("python")}
                >
                  <div className="welcome-card-icon python">
                    <FileCode size={18} color="#ffd166" />
                  </div>
                  <div className="welcome-card-body">
                    <div className="welcome-card-title-row">
                      <span className="welcome-card-title">Get Started with Python Development</span>
                      <span className="welcome-badge">Updated</span>
                    </div>
                    <p className="welcome-card-desc">
                      Write and run Python 3 scripts with interactive REPL and stdout/stderr capture.
                    </p>
                  </div>
                </div>

                <div
                  className="welcome-card"
                  onClick={() => onSelectWalkthrough?.("c-cpp")}
                >
                  <div className="welcome-card-icon cpp">
                    <FileCode size={18} color="#457b9d" />
                  </div>
                  <div className="welcome-card-body">
                    <div className="welcome-card-title-row">
                      <span className="welcome-card-title">Get Started with C / C++ Development</span>
                      <span className="welcome-badge">Lab-Safe</span>
                    </div>
                    <p className="welcome-card-desc">
                      Compile C & C++ files with GCC/Clang under strict memory and timeout budgets.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="welcome-footer">
          <div
            className="welcome-cta-btn"
            onClick={onOpenTerminal}
          >
            <Sparkles size={14} color="#61dafb" />
            <span>Try out the interactive Terminal</span>
            <ArrowRight size={13} />
          </div>

          <label className="welcome-startup-checkbox">
            <input
              type="checkbox"
              checked={showOnStartup}
              onChange={(e) => onToggleShowOnStartup(e.target.checked)}
            />
            <span>Show welcome page on startup</span>
          </label>
        </div>
      </div>
    </div>
  );
};
