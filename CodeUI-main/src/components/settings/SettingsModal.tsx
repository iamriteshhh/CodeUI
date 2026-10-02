import React, { useState } from "react";
import { X, Settings as SettingsIcon, Save, RotateCcw } from "lucide-react";
import { UserSettings } from "../../types";

interface SettingsModalProps {
  isOpen: boolean;
  settings: UserSettings;
  onClose: () => void;
  onSave: (newSettings: UserSettings) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSave,
}) => {
  const [theme, setTheme] = useState<"dark" | "light">(settings.theme || "dark");
  const [fontSize, setFontSize] = useState<number>(settings.fontSize || 14);
  const [tabWidth, setTabWidth] = useState<number>(settings.tabWidth || 4);
  const [runTimeoutSecs, setRunTimeoutSecs] = useState<number>(settings.runTimeoutSecs || 12);
  const [shellPath, setShellPath] = useState<string>(settings.shellPath || "");
  const [showWelcome, setShowWelcome] = useState<boolean>(
    settings.showWelcomeOnStartup !== undefined ? settings.showWelcomeOnStartup : true
  );

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      ...settings,
      theme,
      fontSize,
      tabWidth,
      runTimeoutSecs,
      shellPath: shellPath.trim() || null,
      showWelcomeOnStartup: showWelcome,
    });
    onClose();
  };

  const handleReset = () => {
    setTheme("dark");
    setFontSize(14);
    setTabWidth(4);
    setRunTimeoutSecs(12);
    setShellPath("");
    setShowWelcome(true);
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(2px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 500,
          maxWidth: "90%",
          backgroundColor: "#252526",
          border: "1px solid #454545",
          borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
          display: "flex",
          flexDirection: "column",
          color: "#cccccc",
          fontFamily: "var(--font-ui)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid #333333",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SettingsIcon size={18} color="#007acc" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#ffffff" }}>
              Settings & Preferences
            </span>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Theme */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0" }}>Editor Theme</div>
              <div style={{ fontSize: 11, color: "#888888" }}>Dark or Light syntax palette</div>
            </div>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "dark" | "light")}
              style={{
                background: "#3c3c3c",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: 3,
                padding: "4px 8px",
                fontSize: 12,
              }}
            >
              <option value="dark">Dark Theme (Default)</option>
              <option value="light">Light Theme</option>
            </select>
          </div>

          {/* Font Size */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0" }}>Font Size</div>
              <div style={{ fontSize: 11, color: "#888888" }}>Monaco editor font size ({fontSize}px)</div>
            </div>
            <input
              type="number"
              min={12}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              style={{
                width: 70,
                background: "#3c3c3c",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: 3,
                padding: "4px 8px",
                fontSize: 12,
              }}
            />
          </div>

          {/* Tab Width */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0" }}>Tab Size</div>
              <div style={{ fontSize: 11, color: "#888888" }}>Number of spaces per indentation</div>
            </div>
            <select
              value={tabWidth}
              onChange={(e) => setTabWidth(Number(e.target.value))}
              style={{
                background: "#3c3c3c",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: 3,
                padding: "4px 8px",
                fontSize: 12,
              }}
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </div>

          {/* Execution Timeout */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0" }}>Run Timeout (Secs)</div>
              <div style={{ fontSize: 11, color: "#888888" }}>Lab-safe protection against infinite loops</div>
            </div>
            <input
              type="number"
              min={1}
              max={300}
              value={runTimeoutSecs}
              onChange={(e) => setRunTimeoutSecs(Number(e.target.value))}
              style={{
                width: 70,
                background: "#3c3c3c",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: 3,
                padding: "4px 8px",
                fontSize: 12,
              }}
            />
          </div>

          {/* Shell Path */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0", marginBottom: 2 }}>
              Default Shell Path
            </div>
            <div style={{ fontSize: 11, color: "#888888", marginBottom: 6 }}>
              Leave blank to use system default (powershell.exe / bash)
            </div>
            <input
              type="text"
              placeholder="e.g. C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
              value={shellPath}
              onChange={(e) => setShellPath(e.target.value)}
              style={{
                width: "100%",
                background: "#3c3c3c",
                color: "#fff",
                border: "1px solid #555",
                borderRadius: 3,
                padding: "5px 8px",
                fontSize: 12,
              }}
            />
          </div>

          {/* Show Welcome on Startup */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "#e0e0e0" }}>Welcome Page</div>
              <div style={{ fontSize: 11, color: "#888888" }}>Show the Welcome screen on startup</div>
            </div>
            <input
              type="checkbox"
              checked={showWelcome}
              onChange={(e) => setShowWelcome(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "#007acc", cursor: "pointer" }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 18px",
            borderTop: "1px solid #333333",
            backgroundColor: "#202020",
          }}
        >
          <button
            onClick={handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid #444",
              color: "#aaa",
              padding: "5px 12px",
              borderRadius: 3,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <RotateCcw size={13} />
            <span>Reset Defaults</span>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "1px solid #444",
                color: "#ccc",
                padding: "5px 12px",
                borderRadius: 3,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#007acc",
                border: "none",
                color: "#fff",
                padding: "5px 14px",
                borderRadius: 3,
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <Save size={13} />
              <span>Save & Apply</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
