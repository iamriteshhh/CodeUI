import React from "react";
import { Play, CheckCircle2, AlertCircle, RefreshCw, Terminal, Clock } from "lucide-react";
import { OpenFile, ToolStatus } from "../../types";

interface RunPanelProps {
  activeFile: OpenFile | undefined;
  tools: ToolStatus[];
  onRunFile: () => void;
  onRefreshTools: () => void;
  onOpenTerminal: () => void;
  /** Configured idle timeout (settings.runTimeoutSecs). */
  runTimeoutSecs: number;
}

export const RunPanel: React.FC<RunPanelProps> = ({
  activeFile,
  tools,
  onRunFile,
  onRefreshTools,
  onOpenTerminal,
  runTimeoutSecs,
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "16px", color: "var(--text-primary)" }}>
      {/* Active Target Header */}
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>
          Target File
        </span>
        <div style={{ marginTop: 6, padding: "8px 12px", background: "var(--bg-app)", borderRadius: 4, border: "1px solid var(--border-subtle)" }}>
          {activeFile ? (
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-bright)", fontSize: 13 }}>{activeFile.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeFile.path}
              </div>
              <div style={{ marginTop: 6, display: "inline-block", fontSize: 10, padding: "1px 6px", background: "rgba(0,122,204,0.25)", color: "#61dafb", borderRadius: 3 }}>
                {activeFile.language.toUpperCase()}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No active file selected to run</div>
          )}
        </div>
      </div>

      {/* Primary Action Button */}
      <button
        onClick={onRunFile}
        disabled={!activeFile}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          background: activeFile ? "#1f8a4c" : "var(--border-color)",
          color: activeFile ? "#ffffff" : "var(--text-muted)",
          border: "none",
          padding: "10px",
          borderRadius: 4,
          fontWeight: 600,
          fontSize: 13,
          cursor: activeFile ? "pointer" : "not-allowed",
          marginBottom: 20,
          transition: "background 0.15s ease",
        }}
      >
        <Play size={16} fill={activeFile ? "#ffffff" : "var(--text-muted)"} />
        <span>Run Current File (F5)</span>
      </button>

      {/* Toolchain Health */}
      <div style={{ marginBottom: 20, flex: 1, overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>
            Detected Toolchains
          </span>
          <button
            className="icon-btn"
            title="Refresh Toolchains"
            onClick={onRefreshTools}
            style={{ padding: 2 }}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tools.map((tool) => (
            <div
              key={tool.name}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 10px",
                background: "var(--bg-sidebar)",
                borderRadius: 4,
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {tool.available ? (
                  <CheckCircle2 size={15} color="var(--accent-green)" />
                ) : (
                  <AlertCircle size={15} color="var(--accent-orange)" />
                )}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-bright)" }}>
                    {tool.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {tool.available ? tool.path || "Installed" : "Not Found"}
                  </div>
                </div>
              </div>

              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 3,
                  backgroundColor: tool.available ? "rgba(78,201,176,0.15)" : "rgba(206,145,120,0.15)",
                  color: tool.available ? "var(--accent-green)" : "var(--accent-orange)",
                }}
              >
                {tool.available ? "Ready" : "Missing"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Execution Protection & Terminal */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
          <Clock size={13} />
          <span>Lab-Safe: programs idle for {runTimeoutSecs}s are stopped</span>
        </div>
        <button
          onClick={onOpenTerminal}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: "transparent",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-primary)",
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <Terminal size={14} />
          <span>Launch Interactive Terminal</span>
        </button>
      </div>
    </div>
  );
};
