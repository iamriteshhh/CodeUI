import React from "react";
import { X, Coffee, FileCode, Globe, FileType } from "lucide-react";
import { OpenFile } from "../../types";

interface TabStripProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
}

function getTabIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "java":
      return <Coffee size={13} color="#e76f51" />;
    case "py":
      return <FileCode size={13} color="#ffd166" />;
    case "c":
    case "cpp":
    case "h":
      return <FileCode size={13} color="#457b9d" />;
    case "html":
      return <Globe size={13} color="#f77f00" />;
    case "css":
      return <FileType size={13} color="#4ea8de" />;
    default:
      return <FileCode size={13} color="#a8dadc" />;
  }
}

export const TabStrip: React.FC<TabStripProps> = ({
  openFiles,
  activeFilePath,
  onSelectTab,
  onCloseTab,
}) => {
  return (
    <div className="tabs-container">
      {openFiles.map((file) => {
        const isActive = activeFilePath === file.path;

        return (
          <div
            key={file.path}
            className={`tab ${isActive ? "active" : ""}`}
            onClick={() => onSelectTab(file.path)}
          >
            {getTabIcon(file.name)}
            <span
              style={{
                fontStyle: file.isDirty ? "italic" : "normal",
              }}
            >
              {file.name}
            </span>

            {file.isDirty ? (
              <div
                className="dirty-dot"
                title="Unsaved changes"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.path);
                }}
              />
            ) : (
              <div
                className="tab-close"
                title="Close (Ctrl+W)"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(file.path);
                }}
              >
                <X size={12} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
