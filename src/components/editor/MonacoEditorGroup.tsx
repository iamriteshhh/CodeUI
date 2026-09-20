import React from "react";
import Editor from "@monaco-editor/react";
import { MONACO_LAB_SAFE_OPTIONS } from "./monacoSafeDefaults";
import { OpenFile } from "../../types";
import { ChevronRight } from "lucide-react";
import { FileIcon } from "../icons/FileIcon";
import { editorService } from "../../services/editorService";
import { registerSalivoLanguage } from "../../languages/salivoMonaco";

interface MonacoEditorGroupProps {
  file: OpenFile | undefined;
  onChangeContent: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onMarkersChange?: (errors: number, warnings: number) => void;
}

export const MonacoEditorGroup: React.FC<MonacoEditorGroupProps> = ({
  file,
  onChangeContent,
  onSave,
  onCursorChange,
  onMarkersChange,
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
        <FileIcon fileName={file.name} size={14} />
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
          beforeMount={(monaco) => {
            registerSalivoLanguage(monaco);
          }}
          onChange={(value) => {
            if (value !== undefined) {
              onChangeContent(file.path, value);
            }
          }}
          onMount={(editor, monaco) => {
            registerSalivoLanguage(monaco);
            editorService.setActiveEditor(editor);
            editorService.setMonaco(monaco);

            editor.onDidFocusEditorText(() => {
              editorService.setActiveEditor(editor);
            });

            // Track live cursor position
            editor.onDidChangeCursorPosition((e) => {
              onCursorChange?.(e.position.lineNumber, e.position.column);
            });

            // Track live diagnostics / syntax errors & warnings
            const updateMarkers = () => {
              const model = editor.getModel();
              if (model) {
                const markers = monaco.editor.getModelMarkers({ resource: model.uri });
                const errors = markers.filter((m: any) => m.severity === monaco.MarkerSeverity.Error).length;
                const warnings = markers.filter((m: any) => m.severity === monaco.MarkerSeverity.Warning).length;
                onMarkersChange?.(errors, warnings);
              }
            };

            monaco.editor.onDidChangeMarkers(() => {
              updateMarkers();
            });
            updateMarkers();

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
