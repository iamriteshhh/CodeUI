import React from "react";
import { Play, SplitSquareVertical, Globe } from "lucide-react";
import { OpenFile, ExtensionItem } from "../../types";
import { TabStrip } from "./TabStrip";

const RUN_LABELS: Record<string, string> = {
  salivo: "Run Salivo",
  java: "Run Java",
  python: "Run Python",
  c: "Run C",
  cpp: "Run C++",
  html: "Live Preview",
};

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

  // Only languages with a backend runner (src-tauri/src/runners) get a Run button.
  const runLabel = activeFile ? RUN_LABELS[activeFile.language] : undefined;

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
          {runLabel && (
            <button
              className="run-action-btn"
              title={runLabel}
              onClick={isHtml ? onTogglePreview : onRunFile}
            >
              {isHtml ? <Globe size={13} /> : <Play size={13} fill="var(--text-bright)" />}
              <span>{runLabel}</span>
            </button>
          )}

          {isHtml && (
            <button
              className="icon-btn"
              title="Toggle Live Web Preview"
              onClick={onTogglePreview}
              style={{ color: previewActive ? "var(--accent-blue)" : "var(--text-primary)" }}
            >
              <Globe size={15} />
            </button>
          )}

          <button
            className="icon-btn"
            title={isSplit ? "Close Split Editor" : "Split Editor Right"}
            onClick={onToggleSplit}
            style={{ color: isSplit ? "var(--accent-blue)" : "var(--text-primary)" }}
          >
            <SplitSquareVertical size={15} />
          </button>
        </div>
      )}
    </div>
  );
};
