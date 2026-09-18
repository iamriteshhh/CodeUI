import React from "react";
import Editor from "@monaco-editor/react";
import { MONACO_LAB_SAFE_OPTIONS } from "./monacoSafeDefaults";
import { OpenFile } from "../../types";
import { ChevronRight } from "lucide-react";

interface MonacoEditorGroupProps {
  file: OpenFile | undefined;
  onChangeContent: (path: string, content: string) => void;
  onSave: (path: string) => void;
}

export const MonacoEditorGroup: React.FC<MonacoEditorGroupProps> = ({
  file,
  onChangeContent,
  onSave,
}) => {
  if (!file) {
    return (
      <div className="empty-watermark">
        <div style={{ fontSize: 48, opacity: 0.1, fontWeight: 700 }}>CodeUI</div>
        <div className="shortcuts-table">
          <div className="shortcut-row">
            <span>Show All Commands</span>
            <span className="shortcut-key">Ctrl + Shift + P</span>
          </div>
          <div className="shortcut-row">
            <span>Open Settings</span>
            <span className="shortcut-key">Ctrl + ,</span>
          </div>
          <div className="shortcut-row">
            <span>Find in Files</span>
            <span className="shortcut-key">Ctrl + Shift + F</span>
          </div>
          <div className="shortcut-row">
            <span>Toggle Terminal</span>
            <span className="shortcut-key">Ctrl + `</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      {/* Breadcrumb row */}
      <div className="breadcrumb-bar">
        <span>{file.name}</span>
        <ChevronRight size={12} />
        <span style={{ color: "#e0e0e0" }}>
          {file.name.replace(/\.[^/.]+$/, "")}
        </span>
      </div>

      {/* Monaco Editor Container */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <Editor
          height="100%"
          path={file.path}
          language={file.language}
          value={file.content}
          theme="vs-dark"
          options={MONACO_LAB_SAFE_OPTIONS}
          onChange={(value) => {
            if (value !== undefined) {
              onChangeContent(file.path, value);
            }
          }}
          onMount={(editor, monaco) => {
            // Add Ctrl+S keybinding directly in Monaco
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              onSave(file.path);
            });
          }}
        />
      </div>
    </div>
  );
};
