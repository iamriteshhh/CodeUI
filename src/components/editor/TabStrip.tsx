import React from "react";
import { X, Code2, Blocks } from "lucide-react";
import { OpenFile, ExtensionItem } from "../../types";
import { FileIcon } from "../icons/FileIcon";

interface TabStripProps {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  isWelcomeOpen?: boolean;
  activeExtension?: ExtensionItem | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onSelectWelcome?: () => void;
  onCloseWelcome?: () => void;
  onSelectExtension?: () => void;
  onCloseExtension?: () => void;
}

export const TabStrip: React.FC<TabStripProps> = ({
  openFiles,
  activeFilePath,
  isWelcomeOpen,
  activeExtension,
  onSelectTab,
  onCloseTab,
  onSelectWelcome,
  onCloseWelcome,
  onSelectExtension,
  onCloseExtension,
}) => {
  const isWelcomeActive = activeFilePath === "codeui://welcome" || (isWelcomeOpen && !activeFilePath);
  const isExtensionActive = activeFilePath === "codeui://extension";

  return (
    <div className="tabs-container">
      {isWelcomeOpen && (
        <div
          className={`tab ${isWelcomeActive && !isExtensionActive ? "active" : ""}`}
          onClick={onSelectWelcome}
        >
          <Code2 size={13} color="#007acc" />
          <span>Welcome</span>
          <div
            className="tab-close"
            title="Close Welcome"
            onClick={(e) => {
              e.stopPropagation();
              onCloseWelcome?.();
            }}
          >
            <X size={12} />
          </div>
        </div>
      )}

      {activeExtension && (
        <div
          className={`tab ${isExtensionActive ? "active" : ""}`}
          onClick={onSelectExtension}
        >
          <Blocks size={13} color="#3794ff" />
          <span>Extension: {activeExtension.displayName}</span>
          <div
            className="tab-close"
            title="Close Extension"
            onClick={(e) => {
              e.stopPropagation();
              onCloseExtension?.();
            }}
          >
            <X size={12} />
          </div>
        </div>
      )}

      {openFiles.map((file) => {
        const isActive = activeFilePath === file.path;

        return (
          <div
            key={file.path}
            className={`tab ${isActive ? "active" : ""}`}
            onClick={() => onSelectTab(file.path)}
          >
            <FileIcon fileName={file.name} size={14} />
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
