import React, { useState, useEffect } from "react";
import { RotateCw, CheckSquare, Square, Globe } from "lucide-react";
import { OpenFile } from "../../types";
import { fsService } from "../../services/fsService";

/**
 * Defense-in-depth CSP for the student preview. Student scripts are meant to run (the iframe is
 * sandboxed with allow-scripts but WITHOUT allow-same-origin, so it gets an opaque origin), so
 * this policy only restricts schemes: loads are limited to http/https/data/blob (no tauri:,
 * asset:, ipc:, file:), network requests from script to https/wss (blocks http://ipc.localhost
 * and ipc:), and plugins/form posts are off. It intersects with any CSP inherited from the app.
 */
export const PREVIEW_CSP =
  "default-src http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; " +
  "connect-src https: wss:; object-src 'none'; form-action 'none'";

/** Injects the preview CSP <meta> as early as possible without forcing quirks mode. */
export function withPreviewCsp(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const anchor = /<head(?=[\s>])[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (!anchor) return meta + html;
  const at = anchor.index + anchor[0].length;
  return html.slice(0, at) + meta + html.slice(at);
}

interface PreviewPanelProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
}

export const PreviewPanel: React.FC<PreviewPanelProps> = ({
  openFiles,
  activeFilePath,
}) => {
  const [htmlContent, setHtmlContent] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Find active or open HTML file
  const activeFile = openFiles.find((f) => f.path === activeFilePath);
  const htmlFile =
    activeFile?.language === "html"
      ? activeFile
      : openFiles.find((f) => f.language === "html");

  const loadContent = async () => {
    if (!htmlFile) return;
    try {
      const content = await fsService.readFile(htmlFile.path);
      setHtmlContent(content);
      setLastUpdated(new Date());
    } catch {
      // Use buffer content if read from disk fails
      setHtmlContent(htmlFile.content);
      setLastUpdated(new Date());
    }
  };

  useEffect(() => {
    if (htmlFile) {
      if (autoRefresh) {
        setHtmlContent(htmlFile.content);
        setLastUpdated(new Date());
      }
    }
  }, [htmlFile?.content, autoRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* Preview Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          background: "var(--bg-sidebar)",
          borderBottom: "1px solid var(--border-subtle)",
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Globe size={14} color="var(--accent-blue)" />
          <span style={{ fontWeight: 500, color: "var(--text-bright)" }}>
            {htmlFile ? htmlFile.name : "No HTML file open"}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              cursor: "pointer",
              color: autoRefresh ? "var(--accent-green)" : "var(--text-muted)",
              fontSize: 11,
            }}
          >
            {autoRefresh ? <CheckSquare size={13} /> : <Square size={13} />}
            <span>Auto-refresh on edit</span>
          </div>

          <button
            className="icon-btn"
            title="Reload Preview"
            onClick={loadContent}
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}
          >
            <RotateCw size={13} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Preview Iframe (Sandboxed Option B) */}
      <div style={{ flex: 1, backgroundColor: "var(--text-bright)", overflow: "hidden" }}>
        {htmlFile ? (
          <iframe
            title="CodeUI Live Web Preview"
            srcDoc={withPreviewCsp(htmlContent)}
            sandbox="allow-scripts allow-modals"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              backgroundColor: "var(--text-bright)",
            }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--text-muted)",
              backgroundColor: "var(--bg-app)",
              gap: 8,
            }}
          >
            <Globe size={32} opacity={0.3} />
            <p>Open an .html file in the editor to see live web preview.</p>
          </div>
        )}
      </div>
    </div>
  );
};
