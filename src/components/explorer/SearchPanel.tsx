import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  CaseSensitive,
  X,
  Loader2,
} from "lucide-react";
import { SearchResult } from "../../types";
import { fsService } from "../../services/fsService";
import { FileIcon } from "../icons/FileIcon";

interface SearchPanelProps {
  workspacePath: string;
  onSelectResult: (filePath: string, lineNumber: number) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  workspacePath,
  onSelectResult,
}) => {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Perform search with debounce
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(async () => {
      try {
        const res = await fsService.searchFiles(workspacePath, query, caseSensitive, 150);
        setResults(res);
      } catch (err) {
        console.error("Search error:", err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, caseSensitive, workspacePath]);

  // Group matches by file path
  const groupedResults = results.reduce<Record<string, { fileName: string; matches: SearchResult[] }>>(
    (acc, cur) => {
      if (!acc[cur.filePath]) {
        acc[cur.filePath] = { fileName: cur.fileName, matches: [] };
      }
      acc[cur.filePath].matches.push(cur);
      return acc;
    },
    {}
  );

  const fileKeys = Object.keys(groupedResults);

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Search Input Box */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "var(--bg-input)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 3,
            padding: "2px 6px",
          }}
        >
          <Search size={14} color="var(--text-muted)" style={{ marginRight: 6, flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Search files (e.g. function, class)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-bright)",
              fontSize: 12,
            }}
          />
          {query && (
            <button
              className="icon-btn"
              title="Clear search"
              onClick={() => setQuery("")}
              style={{ padding: 2 }}
            >
              <X size={12} />
            </button>
          )}
          <button
            className="icon-btn"
            title="Match Case"
            onClick={() => setCaseSensitive(!caseSensitive)}
            style={{
              padding: 2,
              color: caseSensitive ? "var(--accent-blue)" : "var(--text-muted)",
              backgroundColor: caseSensitive ? "rgba(0,122,204,0.2)" : "transparent",
              borderRadius: 2,
            }}
          >
            <CaseSensitive size={14} />
          </button>
        </div>

        {/* Status Line */}
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          {loading ? (
            <>
              <Loader2 size={12} className="spin" />
              <span>Searching...</span>
            </>
          ) : query ? (
            <span>
              {results.length} results in {fileKeys.length} files
            </span>
          ) : (
            <span>Type to search across workspace</span>
          )}
        </div>
      </div>

      {/* Results List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {fileKeys.map((filePath) => {
          const group = groupedResults[filePath];
          const isCollapsed = collapsedFiles.has(filePath);

          return (
            <div key={filePath} style={{ marginBottom: 2 }}>
              {/* File Header */}
              <div
                onClick={() => toggleFileCollapse(filePath)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--text-bright)",
                  backgroundColor: "var(--bg-app)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  <FileIcon fileName={group.fileName} size={14} />
                  <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {group.fileName}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    backgroundColor: "var(--bg-hover)",
                    padding: "1px 5px",
                    borderRadius: 10,
                    color: "var(--text-muted)",
                  }}
                >
                  {group.matches.length}
                </span>
              </div>

              {/* Matches inside file */}
              {!isCollapsed && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {group.matches.map((m, idx) => (
                    <div
                      key={idx}
                      onClick={() => onSelectResult(m.filePath, m.lineNumber)}
                      className="search-match-item"
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                        padding: "3px 12px 3px 26px",
                        cursor: "pointer",
                        fontSize: 12,
                        color: "var(--text-primary)",
                        fontFamily: "var(--font-mono)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      <span style={{ fontSize: 10, color: "var(--text-muted)", minWidth: 24, textAlign: "right" }}>
                        {m.lineNumber}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.lineContent}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
