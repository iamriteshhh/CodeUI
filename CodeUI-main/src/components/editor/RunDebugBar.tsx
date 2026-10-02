import React from "react";
import { Play, SplitSquareVertical, Globe } from "lucide-react";
import { OpenFile, ExtensionItem } from "../../types";
import { TabStrip } from "./TabStrip";

interface RunDebugBarProps {
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
  onRunFile: () => void;
  isSplit: boolean;
  onToggleSplit: () => void;
  onTogglePreview: () => void;
  previewActive: boolean;
}

export const RunDebugBar: React.FC<RunDebugBarProps> = ({
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
  onRunFile,
  isSplit,
  onToggleSplit,
  onTogglePreview,
  previewActive,
}) => {
  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  let runLabel = "Run";
  if (activeFile) {
    switch (activeFile.language) {
      case "salivo":
        runLabel = "Run Salivo";
        break;
      case "java":
        runLabel = "Run Java";
        break;
      case "python":
        runLabel = "Run Python";
        break;
      case "c":
        runLabel = "Run C";
        break;
      case "cpp":
        runLabel = "Run C++";
        break;
      case "rust":
        runLabel = "Run Rust";
        break;
      case "zig":
        runLabel = "Run Zig";
        break;
      case "go":
        runLabel = "Run Go";
        break;
      case "javascript":
      case "typescript":
        runLabel = "Run JS/TS";
        break;
      case "html":
        runLabel = "Live Preview";
        break;
    }
  }

  const isHtml = activeFile?.language === "html";

  return (
    <div className="run-debug-bar">
      <TabStrip
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        isWelcomeOpen={isWelcomeOpen}
        activeExtension={activeExtension}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onSelectWelcome={onSelectWelcome}
        onCloseWelcome={onCloseWelcome}
        onSelectExtension={onSelectExtension}
        onCloseExtension={onCloseExtension}
      />

      {activeFile && (
        <div className="editor-actions-toolbar">
          <button
            className="run-action-btn"
            title={runLabel}
            onClick={isHtml ? onTogglePreview : onRunFile}
          >
            {isHtml ? <Globe size={13} /> : <Play size={13} fill="#ffffff" />}
            <span>{runLabel}</span>
          </button>

          {isHtml && (
            <button
              className="icon-btn"
              title="Toggle Live Web Preview"
              onClick={onTogglePreview}
              style={{ color: previewActive ? "#007acc" : "#cccccc" }}
            >
              <Globe size={15} />
            </button>
          )}

          <button
            className="icon-btn"
            title={isSplit ? "Close Split Editor" : "Split Editor Right"}
            onClick={onToggleSplit}
            style={{ color: isSplit ? "#007acc" : "#cccccc" }}
          >
            <SplitSquareVertical size={15} />
          </button>
        </div>
      )}
    </div>
  );
};
