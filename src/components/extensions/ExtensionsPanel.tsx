import React, { useState, useEffect, useMemo } from "react";
import {
  RotateCw,
  MoreHorizontal,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  Settings,
  Loader2,
  Globe,
  Check,
  Shield,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Copy,
} from "lucide-react";
import { ExtensionItem, ToolStatus } from "../../types";
import { ExtensionIcon } from "./ExtensionIcon";
import { searchOpenVsxMarketplace, isAiExtension } from "../../services/extensionService";

interface ExtensionsPanelProps {
  extensions: ExtensionItem[];
  tools?: ToolStatus[];
  isSyncing?: boolean;
  selectedExtensionId?: string | null;
  onSelectExtension: (id: string, extItem?: ExtensionItem) => void;
  onToggleInstall?: (id: string, extItem?: ExtensionItem) => void;
  onOpenSettings?: () => void;
  onRefresh?: () => void;
}

export const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({
  extensions,
  tools = [],
  isSyncing = false,
  selectedExtensionId,
  onSelectExtension,
  onRefresh,
}) => {
  const [query, setQuery] = useState("");
  const [toolchainsOpen, setToolchainsOpen] = useState(true);
  const [copiedTool, setCopiedTool] = useState<string | null>(null);
  const [installedOpen, setInstalledOpen] = useState(true);
  const [recommendedOpen, setRecommendedOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(true);
  const [marketplaceResults, setMarketplaceResults] = useState<ExtensionItem[]>([]);
  const [isSearchingMarketplace, setIsSearchingMarketplace] = useState(false);

  const handleCopyHint = (name: string, hint: string) => {
    navigator.clipboard?.writeText(hint);
    setCopiedTool(name);
    setTimeout(() => setCopiedTool(null), 2000);
  };

  const installedExtensions = useMemo(
    () => extensions.filter((e) => e.installed),
    [extensions]
  );
  const recommendedExtensions = useMemo(
    () => extensions.filter((e) => !e.installed),
    [extensions]
  );

  // Live marketplace search debounced
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setMarketplaceResults([]);
      setIsSearchingMarketplace(false);
      return;
    }

    setIsSearchingMarketplace(true);
    const timeout = setTimeout(() => {
      searchOpenVsxMarketplace(trimmed)
        .then((results) => {
          setMarketplaceResults(results);
        })
        .catch(() => {
          setMarketplaceResults([]);
        })
        .finally(() => {
          setIsSearchingMarketplace(false);
        });
    }, 350);

    return () => clearTimeout(timeout);
  }, [query]);

  const filterExts = (list: ExtensionItem[]) => {
    if (!query.trim()) return list;
    const lower = query.toLowerCase();
    return list.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.displayName.toLowerCase().includes(lower) ||
        e.description.toLowerCase().includes(lower) ||
        e.publisher.toLowerCase().includes(lower) ||
        (e.categories && e.categories.some((c) => c.toLowerCase().includes(lower)))
    );
  };

  const visibleInstalled = filterExts(installedExtensions);
  const visibleRecommended = filterExts(recommendedExtensions);
  const isSearching = query.trim().length > 0;

  return (
    <div className="extensions-sidebar-container">
      {/* 1. Header Toolbar */}
      <div className="extensions-sidebar-header">
        <span className="extensions-sidebar-title">Extensions</span>
        <div className="extensions-sidebar-header-actions">
          <button
            className={`icon-btn ${isSyncing ? "spin" : ""}`}
            title={isSyncing ? "Syncing live data with Open VSX..." : "Refresh Extensions"}
            onClick={onRefresh}
            disabled={isSyncing}
          >
            <RotateCw size={13} />
          </button>
          <button className="icon-btn" title="More Actions...">
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* 2. Search Input Box */}
      <div className="extensions-search-section">
        <div className="extensions-search-box">
          <input
            type="text"
            placeholder="Search Extensions in Marketplace"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="icon-btn search-filter-btn" title="Filter Extensions">
            <SlidersHorizontal size={13} />
          </button>
        </div>

        {/* Professional Security Policy Notice */}
        <div
          style={{
            margin: "6px 0 6px 0",
            padding: "6px 8px",
            background: "#1e1e1e",
            border: "1px solid #2d2d2d",
            borderLeft: "3px solid #007acc",
            borderRadius: 2,
            lineHeight: 1.35,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#cccccc", fontWeight: 600, fontSize: 11 }}>
            <Shield size={12} style={{ color: "#007acc", flexShrink: 0 }} />
            <span>Security Policy</span>
          </div>
          <div style={{ color: "#858585", fontSize: 10.5, marginTop: 2 }}>
            AI code extensions are restricted by workspace policy.
          </div>
        </div>

        <div className="extensions-marketplace-note">
          CodeUI provides direct execution via native toolchains and bundled syntax grammars. External VSIX extension runtime is not loaded in practical laboratory mode.
        </div>
      </div>

      {/* 3. Extension & Toolchain Tree Lists */}
      <div className="extensions-list-scroll">
        {/* Toolchains & Compilers Health Section (Y4) */}
        {tools && tools.length > 0 && (
          <div className="extensions-group">
            <div
              className="extensions-group-header"
              onClick={() => setToolchainsOpen(!toolchainsOpen)}
            >
              <div className="extensions-group-title">
                {toolchainsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Cpu size={13} style={{ marginRight: 4, color: "#4ec9b0" }} />
                <span>Toolchains & Compilers</span>
              </div>
              <span className="extensions-count-badge">
                {tools.filter((t) => t.available).length}/{tools.length}
              </span>
            </div>

            {toolchainsOpen && (
              <div className="extensions-items-list" style={{ padding: "4px 8px 8px" }}>
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      background: tool.available ? "#1f2328" : "#251c1c",
                      border: `1px solid ${tool.available ? "#30363d" : "#442727"}`,
                      borderRadius: 4,
                      marginBottom: 4,
                      fontSize: 11,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {tool.available ? (
                          <CheckCircle2 size={13} style={{ color: "#3fb950", flexShrink: 0 }} />
                        ) : (
                          <AlertCircle size={13} style={{ color: "#f85149", flexShrink: 0 }} />
                        )}
                        <span style={{ fontWeight: 600, color: "#e6edf3" }}>{tool.name}</span>
                        <span style={{ color: "#8b949e", fontSize: 10 }}>{tool.purpose}</span>
                      </div>

                      {tool.available && tool.path && (
                        <div
                          style={{
                            color: "#8b949e",
                            fontSize: 10,
                            marginTop: 2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={tool.path}
                        >
                          {tool.path}
                        </div>
                      )}

                      {!tool.available && (
                        <div style={{ color: "#d29922", fontSize: 10, marginTop: 2 }}>
                          {tool.installHint}
                        </div>
                      )}
                    </div>

                    {!tool.available && tool.installHint && (
                      <button
                        className="icon-btn"
                        onClick={() => handleCopyHint(tool.name, tool.installHint!)}
                        title="Copy install command"
                        style={{
                          padding: "2px 6px",
                          fontSize: 10,
                          marginLeft: 6,
                          flexShrink: 0,
                          background: "#333",
                          borderRadius: 3,
                          color: copiedTool === tool.name ? "#3fb950" : "#ccc",
                        }}
                      >
                        {copiedTool === tool.name ? "Copied" : <Copy size={11} />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Installed Section */}
        <div className="extensions-group">
          <div
            className="extensions-group-header"
            onClick={() => setInstalledOpen(!installedOpen)}
          >
            <div className="extensions-group-title">
              {installedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Installed</span>
            </div>
            <span className="extensions-count-badge">{visibleInstalled.length}</span>
          </div>

          {installedOpen && (
            <div className="extensions-items-list">
              {visibleInstalled.map((ext) => {
                const isSelected = selectedExtensionId === ext.id;

                return (
                  <div
                    key={ext.id}
                    className={`extension-list-row ${isSelected ? "selected" : ""}`}
                    onClick={() => onSelectExtension(ext.id, ext)}
                  >
                    <div className="extension-list-icon">
                      <ExtensionIcon iconType={ext.iconType} iconUrl={ext.iconUrl} size={36} />
                    </div>

                    <div className="extension-list-info">
                      <div className="extension-list-name-row">
                        <span className="extension-list-name" title={ext.displayName}>{ext.displayName}</span>
                      </div>

                      <div className="extension-list-desc">{ext.description}</div>

                      <div className="extension-list-publisher-row">
                        <div style={{ display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <span className="extension-list-publisher">{ext.publisher}</span>
                          <span style={{ fontSize: 10.5, color: "#777777", marginLeft: 4 }}>
                            v{ext.version}
                          </span>
                          {ext.id === "salivo.salivo-tools" ? (
                            <span style={{ fontSize: 10, color: "#4ec9b0", marginLeft: 6 }}>
                              • Built-in
                            </span>
                          ) : ext.systemDetected ? (
                            <span
                              style={{ fontSize: 10, color: "#858585", marginLeft: 6 }}
                              title={ext.systemToolPath ? `System binary: ${ext.systemToolPath}` : "Installed on system"}
                            >
                              • System
                            </span>
                          ) : null}
                        </div>
                        <button
                          className="icon-btn extension-row-gear"
                          title="Manage Extension"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectExtension(ext.id, ext);
                          }}
                        >
                          <Settings size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {visibleInstalled.length === 0 && (
                <div style={{ padding: "8px 16px", color: "#666666", fontSize: 12 }}>
                  {isSearching ? "No installed extensions match this search." : "No extensions installed."}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recommended Section (when not searching) */}
        {!isSearching && (
          <div className="extensions-group">
            <div
              className="extensions-group-header"
              onClick={() => setRecommendedOpen(!recommendedOpen)}
            >
              <div className="extensions-group-title">
                {recommendedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>Recommended</span>
              </div>
              <span className="extensions-count-badge">{visibleRecommended.length}</span>
            </div>

            {recommendedOpen && (
              <div className="extensions-items-list">
                {visibleRecommended.map((ext) => {
                  const isSelected = selectedExtensionId === ext.id;

                  return (
                    <div
                      key={ext.id}
                      className={`extension-list-row ${isSelected ? "selected" : ""}`}
                      onClick={() => onSelectExtension(ext.id, ext)}
                    >
                      <div className="extension-list-icon">
                        <ExtensionIcon iconType={ext.iconType} iconUrl={ext.iconUrl} size={36} />
                      </div>

                      <div className="extension-list-info">
                        <div className="extension-list-name-row">
                          <span className="extension-list-name" title={ext.displayName}>{ext.displayName}</span>
                        </div>
                        <div className="extension-list-desc">{ext.description}</div>
                        <div className="extension-list-publisher-row">
                          <span className="extension-list-publisher">{ext.publisher}</span>
                          {ext.blockedByPolicy || isAiExtension(ext) ? (
                            <span
                              style={{
                                fontSize: 10.5,
                                color: "#858585",
                                background: "#252526",
                                border: "1px solid #333333",
                                padding: "1px 6px",
                                borderRadius: 2,
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                cursor: "not-allowed",
                              }}
                              title={ext.blockReason || "Restricted by security policy: AI assistants disabled"}
                            >
                              <Shield size={10} style={{ color: "#6e7681" }} />
                              Restricted
                            </span>
                          ) : (
                            <button
                              className="extension-install-badge-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectExtension(ext.id, ext);
                              }}
                              title="View extension documentation"
                            >
                              Details
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Live Marketplace Section (when searching) */}
        {isSearching && (
          <div className="extensions-group">
            <div
              className="extensions-group-header"
              onClick={() => setMarketplaceOpen(!marketplaceOpen)}
            >
              <div className="extensions-group-title">
                {marketplaceOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Globe size={13} style={{ marginRight: 4, color: "#007acc" }} />
                <span>Marketplace</span>
              </div>
              <span className="extensions-count-badge">
                {isSearchingMarketplace ? "..." : marketplaceResults.length}
              </span>
            </div>

            {marketplaceOpen && (
              <div className="extensions-items-list">
                {isSearchingMarketplace && (
                  <div className="extension-marketplace-loading">
                    <Loader2 size={13} className="spin" />
                    <span>Searching Open VSX live registry...</span>
                  </div>
                )}

                {!isSearchingMarketplace &&
                  marketplaceResults.map((ext) => {
                    const isSelected = selectedExtensionId === ext.id;
                    const isInstalled = extensions.some((e) => e.id === ext.id && e.installed);

                    return (
                      <div
                        key={ext.id}
                        className={`extension-list-row ${isSelected ? "selected" : ""}`}
                        onClick={() => onSelectExtension(ext.id, ext)}
                      >
                        <div className="extension-list-icon">
                          <ExtensionIcon iconType={ext.iconType} iconUrl={ext.iconUrl} size={36} />
                        </div>

                        <div className="extension-list-info">
                          <div className="extension-list-name-row">
                            <span className="extension-list-name" title={ext.displayName}>{ext.displayName}</span>
                          </div>

                          <div className="extension-list-desc">{ext.description}</div>

                          <div className="extension-list-publisher-row">
                            <span className="extension-list-publisher">{ext.publisher}</span>
                            <span style={{ fontSize: 11, color: "#777777", marginLeft: 4 }}>
                              v{ext.version}
                            </span>
                            {isInstalled ? (
                              <span style={{ fontSize: 11, color: "#858585", display: "flex", alignItems: "center", gap: 3 }}>
                                <Check size={11} /> Installed
                              </span>
                            ) : ext.blockedByPolicy || isAiExtension(ext) ? (
                              <span
                                style={{
                                  fontSize: 10.5,
                                  color: "#858585",
                                  background: "#252526",
                                  border: "1px solid #333333",
                                  padding: "1px 6px",
                                  borderRadius: 2,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  cursor: "not-allowed",
                                }}
                                title={ext.blockReason || "Restricted by security policy: AI assistants disabled"}
                              >
                                <Shield size={10} style={{ color: "#6e7681" }} />
                                Restricted
                              </span>
                            ) : (
                              <button
                                className="extension-install-badge-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectExtension(ext.id, ext);
                                }}
                                title="View extension documentation"
                              >
                                Details
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                {!isSearchingMarketplace && marketplaceResults.length === 0 && query.trim().length >= 2 && (
                  <div style={{ padding: "10px 16px", color: "#666666", fontSize: 12 }}>
                    No matching marketplace extensions found on Open VSX.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
