import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { ExtensionItem, ToolStatus } from "../../types";
import { ExtensionIcon } from "./ExtensionIcon";
import { searchOpenVsxMarketplace } from "../../services/extensionService";

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
  isSyncing = false,
  selectedExtensionId,
  onSelectExtension,
  onToggleInstall,
  onOpenSettings,
  onRefresh,
}) => {
  const [query, setQuery] = useState("");
  const [installedOpen, setInstalledOpen] = useState(true);
  const [recommendedOpen, setRecommendedOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(true);
  const [marketplaceResults, setMarketplaceResults] = useState<ExtensionItem[]>([]);
  const [isSearchingMarketplace, setIsSearchingMarketplace] = useState(false);

  const installedExtensions = extensions.filter((e) => e.installed);
  const recommendedExtensions = extensions.filter((e) => !e.installed);

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
          const installedIds = new Set(installedExtensions.map((e) => e.id));
          const filtered = results.filter((r) => !installedIds.has(r.id));
          setMarketplaceResults(filtered);
        })
        .catch(() => {
          setMarketplaceResults([]);
        })
        .finally(() => {
          setIsSearchingMarketplace(false);
        });
    }, 350);

    return () => clearTimeout(timeout);
  }, [query, installedExtensions]);

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

        <div className="extensions-marketplace-note">
          By default, CodeUI uses Open VSX as a live marketplace. This can be changed in{" "}
          <span className="settings-link" onClick={onOpenSettings}>
            CodeUI settings
          </span>
          .
        </div>
      </div>

      {/* 3. Extension Tree Lists */}
      <div className="extensions-list-scroll">
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
                        <span className="extension-list-name">{ext.displayName}</span>
                      </div>

                      <div className="extension-list-desc">{ext.description}</div>

                      <div className="extension-list-publisher-row">
                        <span className="extension-list-publisher">{ext.publisher}</span>
                        <span style={{ fontSize: 11, color: "#777777", marginLeft: 4 }}>
                          v{ext.version}
                        </span>
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
                          <span className="extension-list-name">{ext.displayName}</span>
                        </div>
                        <div className="extension-list-desc">{ext.description}</div>
                        <div className="extension-list-publisher-row">
                          <span className="extension-list-publisher">{ext.publisher}</span>
                          <button
                            className="extension-install-badge-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleInstall?.(ext.id, ext);
                            }}
                          >
                            Install
                          </button>
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
                            <span className="extension-list-name">{ext.displayName}</span>
                          </div>

                          <div className="extension-list-desc">{ext.description}</div>

                          <div className="extension-list-publisher-row">
                            <span className="extension-list-publisher">{ext.publisher}</span>
                            <span style={{ fontSize: 11, color: "#777777", marginLeft: 4 }}>
                              v{ext.version}
                            </span>
                            {isInstalled ? (
                              <span style={{ fontSize: 11, color: "#4ec9b0", display: "flex", alignItems: "center", gap: 3 }}>
                                <Check size={11} /> Installed
                              </span>
                            ) : (
                              <button
                                className="extension-install-badge-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleInstall?.(ext.id, ext);
                                }}
                              >
                                Install
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
