import React, { useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { FileEntry } from "../../types";
import { fsService } from "../../services/fsService";
import { FileIcon } from "../icons/FileIcon";

interface QuickOpenModalProps {
  isOpen: boolean;
  workspacePath: string;
  onClose: () => void;
  onSelectFile: (path: string, name: string) => void;
}

export const QuickOpenModal: React.FC<QuickOpenModalProps> = ({
  isOpen,
  workspacePath,
  onClose,
  onSelectFile,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input and load initial files when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      fsService.findFiles(workspacePath, "", 40).then((files) => {
        setResults(files);
      });
    }
  }, [isOpen, workspacePath]);

  // Query search
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      fsService.findFiles(workspacePath, query, 50).then((files) => {
        setResults(files);
        setSelectedIndex(0);
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [query, isOpen, workspacePath]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1 < results.length ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : Math.max(0, results.length - 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        const item = results[selectedIndex];
        onSelectFile(item.path, item.name);
        onClose();
      }
    }
  };

  // Keep selected item in view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement | undefined;
      if (activeEl) {
        activeEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="quick-open-backdrop" onClick={onClose}>
      <div
        className="quick-open-container"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="quick-open-input-wrapper">
          <Search size={15} color="#8c8c8c" />
          <input
            ref={inputRef}
            className="quick-open-input"
            type="text"
            placeholder="Search files by name (type to filter)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span style={{ fontSize: 11, color: "#666", fontFamily: "var(--font-mono)" }}>
            Esc to close
          </span>
        </div>

        <div ref={listRef} className="quick-open-list">
          {results.length > 0 ? (
            results.map((file, idx) => {
              const isSelected = idx === selectedIndex;
              const relPath = file.path.replace(workspacePath, "").replace(/^[/\\]/, "");

              return (
                <div
                  key={file.path}
                  className={`quick-open-item ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    onSelectFile(file.path, file.name);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <FileIcon fileName={file.name} size={15} />
                  <span style={{ fontWeight: 500 }}>{file.name}</span>
                  <span className="quick-open-path">{relPath}</span>
                </div>
              );
            })
          ) : (
            <div style={{ padding: "16px", textAlign: "center", color: "#777", fontSize: 12 }}>
              No matching files found
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
