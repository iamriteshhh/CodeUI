import React, { useState } from "react";
import { CheckCircle2, AlertCircle, Copy, Terminal, RotateCw, Check } from "lucide-react";
import { ToolStatus } from "../../types";

interface ExtensionsPanelProps {
  tools: ToolStatus[];
  onRefresh: () => void;
  onSendToTerminal: (command: string) => void;
}

export const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({
  tools,
  onRefresh,
  onSendToTerminal,
}) => {
  const [filter, setFilter] = useState("");
  const [copiedName, setCopiedName] = useState<string | null>(null);

  const filteredTools = tools.filter(
    (t) =>
      t.name.toLowerCase().includes(filter.toLowerCase()) ||
      t.purpose.toLowerCase().includes(filter.toLowerCase())
  );

  const handleCopy = (tool: ToolStatus) => {
    navigator.clipboard.writeText(tool.installHint);
    setCopiedName(tool.name);
    setTimeout(() => setCopiedName(null), 2000);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #2d2d2d" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="Search Toolchains / SDKs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{
              flex: 1,
              background: "#3c3c3c",
              border: "1px solid #444",
              color: "#fff",
              padding: "4px 8px",
              borderRadius: 3,
              fontSize: 12,
            }}
          />
          <button className="icon-btn" title="Refresh Toolchain Status" onClick={onRefresh}>
            <RotateCw size={14} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#8c8c8c" }}>
          Tier 1 Toolchain Manager • Non-elevated
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
        {filteredTools.map((tool) => (
          <div
            key={tool.name}
            style={{
              backgroundColor: "#202020",
              border: "1px solid #2d2d2d",
              borderRadius: 4,
              padding: "10px 12px",
              marginBottom: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13, color: "#ffffff" }}>
                {tool.name.toUpperCase()} SDK
              </span>
              {tool.available ? (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "#4ec9b0",
                  }}
                >
                  <CheckCircle2 size={13} /> Installed
                </span>
              ) : (
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: "#f14c4c",
                  }}
                >
                  <AlertCircle size={13} /> Missing
                </span>
              )}
            </div>

            <p style={{ fontSize: 12, color: "#a0a0a0", marginBottom: 8 }}>
              {tool.purpose}
            </p>

            {tool.path && (
              <div
                style={{
                  fontSize: 11,
                  color: "#6c6c6c",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginBottom: 8,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Path: {tool.path}
              </div>
            )}

            {!tool.available && (
              <div
                style={{
                  background: "#161616",
                  border: "1px solid #2d2d2d",
                  borderRadius: 3,
                  padding: "6px 8px",
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  color: "#ffd166",
                  marginBottom: 8,
                  wordBreak: "break-all",
                }}
              >
                {tool.installHint}
              </div>
            )}

            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => handleCopy(tool)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: copiedName === tool.name ? "#2e7d32" : "#333",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: 3,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {copiedName === tool.name ? <Check size={12} /> : <Copy size={12} />}
                {copiedName === tool.name ? "Copied!" : "Copy Command"}
              </button>

              <button
                onClick={() => onSendToTerminal(tool.installHint + "\n")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  background: "#007acc",
                  color: "#fff",
                  border: "none",
                  padding: "4px 8px",
                  borderRadius: 3,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                <Terminal size={12} />
                Send to Terminal
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
