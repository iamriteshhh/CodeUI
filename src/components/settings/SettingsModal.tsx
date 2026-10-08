import React, { useState, useEffect } from "react";
import { X, Settings as SettingsIcon, Save, RotateCcw } from "lucide-react";
import { UserSettings } from "../../types";
import { DEFAULT_SETTINGS } from "../../services/settingsService";

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
  const [theme, setTheme] = useState<"dark" | "light">(settings.theme || DEFAULT_SETTINGS.theme);
  const [fontSize, setFontSize] = useState<number>(settings.fontSize || DEFAULT_SETTINGS.fontSize);
  const [tabWidth, setTabWidth] = useState<number>(settings.tabWidth || DEFAULT_SETTINGS.tabWidth);
  const [runTimeoutSecs, setRunTimeoutSecs] = useState<number>(
    settings.runTimeoutSecs || DEFAULT_SETTINGS.runTimeoutSecs
  );
  const [shellPath, setShellPath] = useState<string>(settings.shellPath || "");
  const [showWelcome, setShowWelcome] = useState<boolean>(
    settings.showWelcomeOnStartup ?? DEFAULT_SETTINGS.showWelcomeOnStartup ?? true
  );

  useEffect(() => {
    setTheme(settings.theme || DEFAULT_SETTINGS.theme);
    setFontSize(settings.fontSize || DEFAULT_SETTINGS.fontSize);
    setTabWidth(settings.tabWidth || DEFAULT_SETTINGS.tabWidth);
    setRunTimeoutSecs(settings.runTimeoutSecs || DEFAULT_SETTINGS.runTimeoutSecs);
    setShellPath(settings.shellPath || "");
    setShowWelcome(settings.showWelcomeOnStartup ?? DEFAULT_SETTINGS.showWelcomeOnStartup ?? true);
  }, [settings]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSave({
      ...settings,
      theme,
      fontSize,
      tabWidth,
      // Same bounds as the input; an empty or invalid field falls back to the default.
      runTimeoutSecs: Math.min(300, Math.max(1, Math.round(runTimeoutSecs) || DEFAULT_SETTINGS.runTimeoutSecs)),
      shellPath: shellPath.trim() || null,
      showWelcomeOnStartup: showWelcome,
    });
    onClose();
  };

  const handleReset = () => {
    setTheme(DEFAULT_SETTINGS.theme);
    setFontSize(DEFAULT_SETTINGS.fontSize);
    setTabWidth(DEFAULT_SETTINGS.tabWidth);
    setRunTimeoutSecs(DEFAULT_SETTINGS.runTimeoutSecs);
    setShellPath(DEFAULT_SETTINGS.shellPath || "");
    setShowWelcome(DEFAULT_SETTINGS.showWelcomeOnStartup ?? true);
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
          backgroundColor: "var(--bg-sidebar)",
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          display: "flex",
          flexDirection: "column",
          color: "var(--text-primary)",
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
            borderBottom: "1px solid var(--border-color)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SettingsIcon size={18} color="var(--accent-blue)" />
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-bright)" }}>
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
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-bright)" }}>Editor Theme</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dark or Light syntax palette</div>
            </div>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "dark" | "light")}
              style={{
                background: "var(--bg-input)",
                color: "var(--text-bright)",
                border: "1px solid var(--border-subtle)",
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
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-bright)" }}>Font Size</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Monaco editor font size ({fontSize}px)</div>
            </div>
            <input
              type="number"
              min={12}
              max={24}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              style={{
                width: 70,
                background: "var(--bg-input)",
                color: "var(--text-bright)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 3,
                padding: "4px 8px",
                fontSize: 12,
              }}
            />
          </div>

          {/* Tab Width */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-bright)" }}>Tab Size</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Number of spaces per indentation</div>
            </div>
            <select
              value={tabWidth}
              onChange={(e) => setTabWidth(Number(e.target.value))}
              style={{
                background: "var(--bg-input)",
                color: "var(--text-bright)",
                border: "1px solid var(--border-subtle)",
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
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-bright)" }}>Idle Timeout (Secs)</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Stop a running program after this many seconds with no activity
              </div>
            </div>
            <input
              type="number"
              min={1}
              max={300}
              value={runTimeoutSecs}
              onChange={(e) => setRunTimeoutSecs(Number(e.target.value))}
              style={{
                width: 70,
                background: "var(--bg-input)",
                color: "var(--text-bright)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 3,
                padding: "4px 8px",
                fontSize: 12,
              }}
            />
          </div>

          {/* Shell Path */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-bright)", marginBottom: 2 }}>
              Default Shell Path
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              Leave blank to use system default (powershell.exe / bash)
            </div>
            <input
              type="text"
              placeholder="e.g. C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
              value={shellPath}
              onChange={(e) => setShellPath(e.target.value)}
              style={{
                width: "100%",
                background: "var(--bg-input)",
                color: "var(--text-bright)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 3,
                padding: "5px 8px",
                fontSize: 12,
              }}
            />
          </div>

          {/* Show Welcome on Startup */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 4 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-bright)" }}>Welcome Page</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Show the Welcome screen on startup</div>
            </div>
            <input
              type="checkbox"
              checked={showWelcome}
              onChange={(e) => setShowWelcome(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: "var(--accent-blue)", cursor: "pointer" }}
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
            borderTop: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-app)",
          }}
        >
          <button
            onClick={handleReset}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-muted)",
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
                border: "1px solid var(--border-subtle)",
                color: "var(--text-primary)",
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
                background: "var(--accent-blue)",
                border: "none",
                color: "#ffffff",
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
