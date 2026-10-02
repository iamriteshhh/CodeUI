import React, { useState } from "react";
import {
  ShieldCheck,
  XCircle,
  AlertTriangle,
  Bell,
  Coffee,
  Code2,
  Check,
  X,
  Info,
} from "lucide-react";
import { OpenFile } from "../../types";
import { editorService } from "../../services/editorService";

interface StatusBarProps {
  activeFile: OpenFile | undefined;
  toolReadyStatus: string;
  cursorPos?: { line: number; col: number };
  errorCount?: number;
  warningCount?: number;
  tabSize?: number;
  onToggleTabSize?: () => void;
  onTogglePanel?: () => void;
  onOpenExtensions?: () => void;
  onLanguageChange?: (lang: string) => void;
}

const SUPPORTED_LANGUAGES = [
  { id: "java", name: "Java" },
  { id: "python", name: "Python" },
  { id: "salivo", name: "Salivo" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
  { id: "rust", name: "Rust" },
  { id: "zig", name: "Zig" },
  { id: "go", name: "Go" },
  { id: "javascript", name: "JavaScript" },
  { id: "typescript", name: "TypeScript" },
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "ruby", name: "Ruby" },
  { id: "php", name: "PHP" },
  { id: "lua", name: "Lua" },
  { id: "csharp", name: "C#" },
  { id: "kotlin", name: "Kotlin" },
  { id: "swift", name: "Swift" },
  { id: "sql", name: "SQL" },
  { id: "json", name: "JSON" },
  { id: "markdown", name: "Markdown" },
  { id: "shell", name: "Shell Script" },
  { id: "plaintext", name: "Plain Text" },
];

export const StatusBar: React.FC<StatusBarProps> = ({
  activeFile,
  toolReadyStatus,
  errorCount = 0,
  warningCount = 0,
  tabSize = 4,
  onToggleTabSize,
  onTogglePanel,
  onOpenExtensions,
  onLanguageChange,
}) => {
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [showRestrictedModal, setShowRestrictedModal] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const [showNotificationToast, setShowNotificationToast] = useState(false);
  const [crlfMode, setCrlfMode] = useState<"CRLF" | "LF">("CRLF");

  React.useEffect(() => {
    return editorService.onCursorChange((line, col) => {
      setCursorPos({ line, col });
    });
  }, []);

  const currentLanguage = activeFile?.language || "plaintext";

  const handleLanguageSelect = (langId: string) => {
    editorService.setLanguage(langId);
    onLanguageChange?.(langId);
    setShowLanguageMenu(false);
  };

  return (
    <>
      <div className="statusbar">
        <div className="statusbar-left">
          {/* Restricted Mode Badge */}
          <div
            className="statusbar-item"
            title="Laboratory Restricted Practical Mode Active (Click for details)"
            onClick={() => setShowRestrictedModal(true)}
          >
            <ShieldCheck size={13} color="#4ec9b0" />
            <span>Restricted Mode</span>
          </div>

          {/* Errors and Warnings Counter */}
          <div
            className="statusbar-item"
            title="Errors & Warnings (Click to toggle Bottom Panel)"
            onClick={onTogglePanel}
          >
            <XCircle size={13} color={errorCount > 0 ? "#f14c4c" : "#cccccc"} />
            <span>{errorCount}</span>
            <AlertTriangle
              size={13}
              color={warningCount > 0 ? "#cca700" : "#cccccc"}
              style={{ marginLeft: 4 }}
            />
            <span>{warningCount}</span>
          </div>

          {/* Environment Toolchain Status */}
          <div
            className="statusbar-item"
            title="Environment Toolchain Status (Click to inspect)"
            onClick={onOpenExtensions}
          >
            <Coffee size={13} />
            <span>{toolReadyStatus}</span>
          </div>
        </div>

        <div className="statusbar-right">
          {/* Dynamic Cursor Position */}
          <div
            className="statusbar-item"
            title="Go to Line/Column (Ctrl+G)"
            onClick={() => editorService.gotoLine()}
          >
            <span>
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
          </div>

          {/* Interactive Indentation Tab Size */}
          <div
            className="statusbar-item"
            title="Click to toggle indentation (Spaces: 2 / Spaces: 4)"
            onClick={() => {
              if (onToggleTabSize) {
                onToggleTabSize();
              } else {
                const nextSize = tabSize === 4 ? 2 : 4;
                editorService.setTabSize(nextSize);
              }
            }}
          >
            <span>Spaces: {tabSize}</span>
          </div>

          {/* Encoding */}
          <div
            className="statusbar-item"
            title="Character Encoding: UTF-8"
          >
            <span>UTF-8</span>
          </div>

          {/* End of Line */}
          <div
            className="statusbar-item"
            title="Click to toggle End-of-Line sequence (CRLF / LF)"
            onClick={() => setCrlfMode((prev) => (prev === "CRLF" ? "LF" : "CRLF"))}
          >
            <span>{crlfMode}</span>
          </div>

          {/* Interactive Language Selector */}
          <div
            className="statusbar-item"
            style={{ fontWeight: 600, position: "relative" }}
            title="Click to switch language syntax mode"
            onClick={() => setShowLanguageMenu(!showLanguageMenu)}
          >
            <Code2 size={13} />
            <span>{currentLanguage.toUpperCase()}</span>
          </div>

          {/* Notifications Bell */}
          <div
            className="statusbar-item"
            title="Notifications"
            onClick={() => {
              setShowNotificationToast(true);
              setTimeout(() => setShowNotificationToast(false), 3000);
            }}
          >
            <Bell size={13} />
          </div>
        </div>
      </div>

      {/* Language Selector Popover */}
      {showLanguageMenu && (
        <div
          className="file-tree-context-menu"
          style={{
            bottom: 24,
            right: 35,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "4px 10px", fontSize: 11, color: "#8c8c8c", fontWeight: 600 }}>
            Select Language Mode
          </div>
          <div className="context-menu-divider" />
          {SUPPORTED_LANGUAGES.map((lang) => (
            <div
              key={lang.id}
              className="context-menu-item"
              onClick={() => handleLanguageSelect(lang.id)}
            >
              <span>{lang.name}</span>
              {currentLanguage.toLowerCase() === lang.id && <Check size={13} color="#4ec9b0" />}
            </div>
          ))}
        </div>
      )}

      {/* Notification Toast */}
      {showNotificationToast && (
        <div
          style={{
            position: "fixed",
            bottom: 30,
            right: 12,
            background: "#252526",
            border: "1px solid #007acc",
            borderRadius: 4,
            padding: "8px 14px",
            color: "#fff",
            fontSize: 12,
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            zIndex: 4000,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Info size={14} color="#007acc" />
          <span>CodeUI is running in distraction-free exam mode. All systems normal.</span>
        </div>
      )}

      {/* Restricted Mode Info Dialog */}
      {showRestrictedModal && (
        <div className="quick-open-backdrop" onClick={() => setShowRestrictedModal(false)}>
          <div
            className="quick-open-container"
            style={{ width: 480, padding: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldCheck size={20} color="#4ec9b0" />
                <span style={{ fontSize: 15, fontWeight: 600, color: "#ffffff" }}>
                  Laboratory Restricted Practical Mode
                </span>
              </div>
              <button
                className="icon-btn"
                onClick={() => setShowRestrictedModal(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ fontSize: 12.5, color: "#a0a0a0", lineHeight: 1.6, marginBottom: 16 }}>
              <p style={{ marginBottom: 10 }}>
                This workspace is configured for college computer lab practicals, competitive programming, and exam assessments.
              </p>
              <ul style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>
                  <strong style={{ color: "#fff" }}>No Autocomplete & Copilot:</strong> IntelliSense suggestion popups and AI assistants are intentionally disabled to verify student understanding.
                </li>
                <li>
                  <strong style={{ color: "#fff" }}>Local Sandboxed Execution:</strong> Student code executes directly in an isolated local terminal without external network leaks.
                </li>
                <li>
                  <strong style={{ color: "#fff" }}>Safe Execution Timeout:</strong> A default 12-second execution safety cap prevents runaway while loops from freezing the workstation.
                </li>
              </ul>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowRestrictedModal(false)}
                style={{
                  background: "#007acc",
                  color: "#fff",
                  border: "none",
                  padding: "6px 16px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
