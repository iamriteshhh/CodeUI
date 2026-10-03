import React, { useState, useEffect, useMemo } from "react";
import { Download, ExternalLink, Loader2, FileText, History, Shield, Palette, Info } from "lucide-react";
import { marked } from "marked";
import { ExtensionItem } from "../../types";
import { ExtensionIcon } from "./ExtensionIcon";
import { fetchLiveExtensionDetails, isAiExtension, readExtensionFile } from "../../services/extensionService";
import { applyColorTheme, getEditorTheme, themeId } from "../../services/extensionHost";
import { notify, formatError } from "../../services/notify";
import { sanitizeHtml } from "../../utils/sanitizeHtml";

marked.setOptions({
  gfm: true,
  breaks: false,
});

interface ExtensionDetailViewProps {
  extension: ExtensionItem;
  onToggleEnabled?: (id: string) => void;
  onToggleInstalled?: (id: string) => void;
}

export const ExtensionDetailView: React.FC<ExtensionDetailViewProps> = ({
  extension,
  onToggleEnabled,
  onToggleInstalled,
}) => {
  const [activeTab, setActiveTab] = useState<"DETAILS" | "CHANGELOG">("DETAILS");
  const [, setThemeTick] = useState(0);
  const [liveReadme, setLiveReadme] = useState<string | null>(null);
  const [loadingReadme, setLoadingReadme] = useState(false);

  const installedId = extension.installedInfo?.id;
  useEffect(() => {
    setLiveReadme(null);
    // Installed (and built-in) extensions show the README shipped in their own package.
    if (installedId) {
      setLoadingReadme(true);
      readExtensionFile(installedId, "README.md")
        .then((text) => setLiveReadme(text))
        .catch(() => {})
        .finally(() => setLoadingReadme(false));
      return;
    }
    const needsReadme =
      (!extension.overviewMarkdown ||
        extension.overviewMarkdown.trim().length < 150 ||
        extension.overviewMarkdown === extension.description);

    if (needsReadme) {
      setLoadingReadme(true);
      fetchLiveExtensionDetails(extension.id)
        .then((details) => {
          if (details?.overviewMarkdown && details.overviewMarkdown.trim().length > 20) {
            setLiveReadme(details.overviewMarkdown);
          }
        })
        .finally(() => setLoadingReadme(false));
    }
  }, [extension.id, extension.overviewMarkdown, extension.description, installedId]);

  const rawMarkdown = liveReadme || extension.overviewMarkdown || "";

  const renderedHtml = useMemo(() => {
    if (!rawMarkdown.trim()) return "";
    try {
      const parsed = marked.parse(rawMarkdown) as string;
      return sanitizeHtml(parsed);
    } catch {
      return `<p>${sanitizeHtml(rawMarkdown)}</p>`;
    }
  }, [rawMarkdown]);

  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest("a");
    if (target && target.href) {
      e.preventDefault();
      window.open(target.href, "_blank", "noopener,noreferrer");
    }
  };

  const formatLicense = (license?: string) => {
    if (!license) return "Open Source";
    if (license.startsWith("%")) return "Commercial / Custom";
    if (license.startsWith("SEE LICENSE")) return "Custom License (Included)";
    return license;
  };

  const cleanRepoUrl = extension.repositoryUrl
    ? extension.repositoryUrl.replace(/\.git$/, "")
    : null;

  const info = extension.installedInfo;
  const isBuiltin = !!info?.builtin;
  const themes = info?.contributes.themes ?? [];
  const busy = !!extension.busy;

  const chooseTheme = async (theme: (typeof themes)[number] | null) => {
    try {
      await applyColorTheme(theme ? extension.id : null, theme);
      setThemeTick((t) => t + 1);
    } catch (err) {
      notify.error("Theme could not be applied", formatError(err));
    }
  };

  return (
    <div className="extension-detail-container">
      {/* 1. Header Banner */}
      <div className="extension-detail-header">
        <div className="extension-detail-icon-box">
          <ExtensionIcon iconType={extension.iconType} iconUrl={extension.iconUrl} size={84} />
        </div>

        <div className="extension-detail-header-info">
          <div className="extension-detail-title-row">
            <h1 className="extension-detail-title">
              {extension.displayName}
              {!extension.enabled && (
                <span style={{ fontSize: 13, color: "#e5c07b", marginLeft: 10, fontWeight: 500 }}>
                  (Disabled)
                </span>
              )}
            </h1>
          </div>

          <div className="extension-detail-meta-row">
            <span className="extension-detail-publisher">{extension.publisher}</span>
            {isBuiltin ? (
              <>
                <span className="meta-separator">|</span>
                <span style={{ color: "#4ec9b0", fontWeight: 500, fontSize: 12 }}>Built-in Extension</span>
                <span className="meta-separator">|</span>
                <span style={{ color: "#8c8c8c", fontSize: 12 }}>Core Language Toolchain</span>
              </>
            ) : (
              <>
                {extension.downloads && extension.downloads !== "0" && (
                  <>
                    <span className="meta-separator">|</span>
                    <span className="extension-detail-downloads">
                      <Download size={13} style={{ marginRight: 4 }} />
                      {extension.downloads}
                    </span>
                  </>
                )}
                {extension.ratingCount > 0 && (
                  <>
                    <span className="meta-separator">|</span>
                    <span className="extension-detail-rating">
                      {"★".repeat(Math.max(1, Math.min(5, Math.floor(extension.rating))))}
                      {"☆".repeat(Math.max(0, 5 - Math.min(5, Math.floor(extension.rating))))}
                      <span style={{ marginLeft: 4, opacity: 0.7 }}>({extension.ratingCount})</span>
                    </span>
                  </>
                )}
              </>
            )}
          </div>

          <p className="extension-detail-short-desc">{extension.description}</p>

          {/* System Detected Toolchain Info (Compact & Native, Non-intrusive) */}
          {extension.systemDetected && !isBuiltin && extension.systemToolPath && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                margin: "4px 0 10px 0",
                padding: "3px 8px",
                background: "#1e1e1e",
                border: "1px solid #2d2d2d",
                borderRadius: 2,
                fontSize: 11,
                color: "#858585",
              }}
            >
              <span>System binary:</span>
              <code style={{ color: "#cccccc", fontFamily: "Consolas, monospace" }}>
                {extension.systemToolPath}
              </code>
            </div>
          )}

          {/* Security Rule: Professional AI Restriction Notice */}
          {(extension.blockedByPolicy || isAiExtension(extension)) && (
            <div
              style={{
                margin: "8px 0 12px 0",
                padding: "8px 12px",
                background: "#1e1e1e",
                border: "1px solid #2d2d2d",
                borderLeft: "3px solid #6e7681",
                borderRadius: 2,
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#cccccc", fontWeight: 600 }}>
                <Shield size={13} style={{ color: "#6e7681", flexShrink: 0 }} />
                <span>Restricted by Policy</span>
              </div>
              <div style={{ color: "#858585", marginTop: 2 }}>
                {extension.blockReason ||
                  "Installation and execution of AI code extensions are restricted by workspace policy."}
              </div>
            </div>
          )}

          {/* Action buttons row */}
          <div className="extension-detail-actions">
            {extension.blockedByPolicy || isAiExtension(extension) ? (
              <button
                className="extension-btn"
                disabled
                style={{
                  background: "#252526",
                  color: "#858585",
                  border: "1px solid #3c3c3c",
                  cursor: "not-allowed",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  fontSize: 11,
                }}
              >
                <Shield size={12} />
                Restricted by Policy
              </button>
            ) : busy ? (
              <button className="extension-btn primary" disabled style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Loader2 size={12} className="spin" />
                {extension.installed ? "Working..." : "Installing..."}
              </button>
            ) : extension.installed ? (
              <>
                <button className="extension-btn primary" onClick={() => onToggleEnabled?.(extension.id)}>
                  {extension.enabled ? "Disable" : "Enable"}
                </button>
                {!isBuiltin && (
                  <button className="extension-btn secondary" onClick={() => onToggleInstalled?.(extension.id)}>
                    Uninstall
                  </button>
                )}
              </>
            ) : (
              <button className="extension-btn install" onClick={() => onToggleInstalled?.(extension.id)}>
                Install
              </button>
            )}
          </div>

          {/* What CodeUI actually loaded from the package */}
          {info && (
            <div
              style={{
                margin: "10px 0 0 0",
                padding: "8px 12px",
                background: "#1e1e1e",
                border: "1px solid #2d2d2d",
                borderLeft: "3px solid #007acc",
                borderRadius: 2,
                fontSize: 11,
                lineHeight: 1.5,
                color: "#a0a0a0",
                maxWidth: 640,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#cccccc", fontWeight: 600 }}>
                <Info size={12} style={{ color: "#007acc" }} />
                <span>In CodeUI</span>
              </div>
              <div>
                {[
                  info.contributes.languages?.length ? `${info.contributes.languages.length} language(s)` : "",
                  info.contributes.grammars?.length ? `${info.contributes.grammars.length} syntax grammar(s)` : "",
                  themes.length ? `${themes.length} color theme(s)` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Nothing CodeUI can load (no grammars, language settings or themes)."}
              </div>
              {info.hasCode && (
                <div>
                  This package also contains extension code (language server, commands, debugger). CodeUI does not run
                  extension code, so those features are not available.
                </div>
              )}
              {themes.length > 0 && extension.enabled && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {themes.map((t) => {
                    const active = getEditorTheme() === themeId(extension.id, t);
                    return (
                      <button
                        key={t.path}
                        className="extension-btn secondary"
                        onClick={() => chooseTheme(active ? null : t)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}
                        title={active ? "Return to the default CodeUI theme" : "Use this color theme in the editor"}
                      >
                        <Palette size={12} />
                        {active ? `${t.label} (active)` : t.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 2. Sub-tab navigation */}
      <div className="extension-subtabs">
        <button
          className={`extension-subtab ${activeTab === "DETAILS" ? "active" : ""}`}
          onClick={() => setActiveTab("DETAILS")}
        >
          <FileText size={12} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
          DETAILS
        </button>
        <button
          className={`extension-subtab ${activeTab === "CHANGELOG" ? "active" : ""}`}
          onClick={() => setActiveTab("CHANGELOG")}
        >
          <History size={12} style={{ marginRight: 6, display: "inline-block", verticalAlign: "middle" }} />
          CHANGELOG
        </button>
      </div>

      {/* 3. Main Body: Two Column Content */}
      <div className="extension-detail-body">
        {/* Left Column (Content) */}
        <div className="extension-detail-main">
          {activeTab === "DETAILS" && (
            <div>
              {loadingReadme && (
                <div className="extension-readme-loading">
                  <Loader2 size={16} className="spin" />
                  <span>Loading official publisher documentation...</span>
                </div>
              )}

              {renderedHtml ? (
                <div
                  className="extension-markdown-content"
                  onClick={handleContentClick}
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              ) : !loadingReadme ? (
                <div className="extension-no-readme">
                  <p>{extension.description || "No documentation provided by publisher."}</p>
                </div>
              ) : null}
            </div>
          )}

          {activeTab === "CHANGELOG" && (
            <div>
              {extension.changelog && extension.changelog.length > 0 ? (
                <div className="changelog-list">
                  {extension.changelog.map((entry, i) => (
                    <div key={i} className="changelog-entry">
                      <div className="changelog-header">
                        <span className="changelog-version">v{entry.version}</span>
                        <span className="changelog-date">{entry.date}</span>
                      </div>
                      <ul className="changelog-bullets">
                        {entry.changes.map((c, j) => (
                          <li key={j}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="extension-changelog-placeholder">
                  <h3 style={{ color: "#ffffff", fontSize: 16, margin: "0 0 8px 0" }}>Release History</h3>
                  <p style={{ color: "#999999", fontSize: 13, lineHeight: 1.6, margin: "0 0 16px 0" }}>
                    Full changelog and releases are published directly on the extension repository.
                  </p>
                  {cleanRepoUrl ? (
                    <a
                      href={`${cleanRepoUrl}/releases`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="extension-repo-link-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(`${cleanRepoUrl}/releases`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <ExternalLink size={13} />
                      <span>View Releases on GitHub</span>
                    </a>
                  ) : (
                    <a
                      href={`https://open-vsx.org/extension/${extension.id.replace(".", "/")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="extension-repo-link-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        window.open(`https://open-vsx.org/extension/${extension.id.replace(".", "/")}`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <ExternalLink size={13} />
                      <span>View Version History on Open VSX</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column (Metadata Sidebar) */}
        <div className="extension-detail-sidebar">
          {/* Installation Info */}
          <div className="sidebar-meta-section">
            <h4 className="sidebar-meta-title">Installation</h4>
            <div className="sidebar-meta-row">
              <span className="sidebar-meta-label">Identifier</span>
              <span className="sidebar-meta-value code">{extension.id}</span>
            </div>
            <div className="sidebar-meta-row">
              <span className="sidebar-meta-label">Version</span>
              <span className="sidebar-meta-value">{extension.version}</span>
            </div>
            <div className="sidebar-meta-row">
              <span className="sidebar-meta-label">Last Updated</span>
              <span className="sidebar-meta-value">{extension.lastUpdated}</span>
            </div>
            <div className="sidebar-meta-row">
              <span className="sidebar-meta-label">License</span>
              <span className="sidebar-meta-value highlight">{formatLicense(extension.license)}</span>
            </div>
          </div>

          {/* Publisher Info */}
          <div className="sidebar-meta-section">
            <h4 className="sidebar-meta-title">Publisher</h4>
            <div className="sidebar-meta-row">
              <span className="sidebar-meta-label">Publisher</span>
              <span className="sidebar-meta-value">{extension.publisher}</span>
            </div>
            <div className="sidebar-meta-row">
              <span className="sidebar-meta-label">Registry</span>
              <span className="sidebar-meta-value">
                {isBuiltin ? "Bundled with CodeUI" : "Open VSX Registry"}
              </span>
            </div>
          </div>

          {/* Categories */}
          {extension.categories && extension.categories.length > 0 && (
            <div className="sidebar-meta-section">
              <h4 className="sidebar-meta-title">Categories</h4>
              <div className="sidebar-categories-pills">
                {extension.categories.map((cat, i) => (
                  <span key={i} className="category-pill">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Resources */}
          <div className="sidebar-meta-section">
            <h4 className="sidebar-meta-title">Resources</h4>
            <div className="sidebar-resource-links">
              {!isBuiltin && (
                <a
                  href="#marketplace"
                  className="resource-link"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(
                      `https://open-vsx.org/extension/${extension.id.replace(".", "/")}`,
                      "_blank",
                      "noopener,noreferrer"
                    );
                  }}
                >
                  <ExternalLink size={13} />
                  <span>Open VSX Marketplace</span>
                </a>
              )}

              {cleanRepoUrl && (
                <a
                  href="#repository"
                  className="resource-link"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(cleanRepoUrl, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink size={13} />
                  <span>Repository</span>
                </a>
              )}

              {cleanRepoUrl && (
                <a
                  href="#issues"
                  className="resource-link"
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(`${cleanRepoUrl}/issues`, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink size={13} />
                  <span>Issues & Feedback</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExtensionDetailView;
