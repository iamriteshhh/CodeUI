import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { unsavedPrompt, PendingUnsavedPrompt } from "../../services/unsavedPrompt";

const buttonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid var(--border-subtle)",
  color: "var(--text-primary)",
  padding: "5px 12px",
  borderRadius: 3,
  fontSize: 12,
  cursor: "pointer",
};

/** Host for unsavedPrompt.ask(): Save All / Don't Save / Cancel. Escape and backdrop click cancel. */
export const UnsavedChangesDialog: React.FC = () => {
  const [prompt, setPrompt] = useState<PendingUnsavedPrompt | null>(null);

  useEffect(() => unsavedPrompt.subscribe(setPrompt), []);

  useEffect(() => {
    if (!prompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        prompt.resolve("cancel");
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prompt]);

  if (!prompt) return null;
  const allowSave = prompt.allowSave !== false;
  const shown = prompt.files.slice(0, 8);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.65)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={() => prompt.resolve("cancel")}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-dialog-title"
        style={{
          width: 440,
          maxWidth: "90%",
          backgroundColor: "var(--bg-sidebar)",
          border: "1px solid var(--border-color)",
          borderRadius: 6,
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-ui)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 10, padding: "16px 18px 12px" }}>
          <AlertTriangle size={20} color="var(--accent-yellow)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ minWidth: 0 }}>
            <div id="unsaved-dialog-title" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-bright)" }}>
              {prompt.title}
            </div>
            <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.4 }}>{prompt.message}</div>
            {shown.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--text-muted)" }}>
                {shown.map((name, i) => (
                  <li key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </li>
                ))}
                {prompt.files.length > shown.length && <li>and {prompt.files.length - shown.length} more</li>}
              </ul>
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border-color)",
            backgroundColor: "var(--bg-app)",
          }}
        >
          {allowSave && (
            <button
              autoFocus
              onClick={() => prompt.resolve("save")}
              style={{ ...buttonStyle, background: "var(--accent-blue)", border: "none", color: "#ffffff", fontWeight: 500 }}
            >
              Save All
            </button>
          )}
          <button autoFocus={!allowSave} onClick={() => prompt.resolve("discard")} style={buttonStyle}>
            {prompt.discardLabel ?? "Don't Save"}
          </button>
          <button onClick={() => prompt.resolve("cancel")} style={buttonStyle}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
