import React from "react";
import Editor from "@monaco-editor/react";
import { MONACO_LAB_SAFE_OPTIONS } from "./monacoSafeDefaults";
import { OpenFile } from "../../types";
import { ChevronRight } from "lucide-react";
import { FileIcon } from "../icons/FileIcon";
import { editorService, getNormalizedUri } from "../../services/editorService";
import { registerAllEagerLanguages } from "../../languages/registerAllLanguages";

interface MonacoEditorGroupProps {
  file: OpenFile | undefined;
  onChangeContent: (path: string, content: string) => void;
  onSave: (path: string) => void;
  onCursorChange?: (line: number, col: number) => void;
  onMarkersChange?: (errors: number, warnings: number) => void;
}

const MonacoEditorGroupComponent: React.FC<MonacoEditorGroupProps> = ({
  file,
  onChangeContent,
  onSave,
  onCursorChange,
  onMarkersChange,
}) => {
  const editorRef = React.useRef<any>(null);
  const monacoRef = React.useRef<any>(null);

  // Recalculate editor model and layout cleanly on file switch
  React.useEffect(() => {
    if (!file?.path || !editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;

    const uriStr = getNormalizedUri(file.path);
    const uri = monaco.Uri.parse(uriStr);
    let model = monaco.editor.getModel(uri);

    const cleanContent = file.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    if (!model) {
      model = monaco.editor.createModel(cleanContent, file.language, uri);
    } else {
      if (file.language) {
        monaco.editor.setModelLanguage(model, file.language);
      }
      if (!file.isDirty && model.getValue() !== cleanContent) {
        model.setValue(cleanContent);
      }
    }

    if (editor.getModel() !== model) {
      editor.setModel(model);
    }

    editor.layout();
  }, [file?.path]);

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
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#1e1e1e", minHeight: 0 }}>
        <Editor
          height="100%"
          path={getNormalizedUri(file.path)}
          language={file.language}
          value={file.content}
          theme="codeui-dark"
          keepCurrentModel={true}
          saveViewState={false}
          loading={<div style={{ height: "100%", width: "100%", background: "#1e1e1e" }} />}
          options={MONACO_LAB_SAFE_OPTIONS}
          beforeMount={(monaco) => {
            registerAllEagerLanguages(monaco);
          }}
          onChange={(value) => {
            if (value !== undefined) {
              onChangeContent(file.path, value);
            }
          }}
          onMount={(editor, monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            registerAllEagerLanguages(monaco);
            monaco.editor.setTheme("codeui-dark");
            editorService.setActiveEditor(editor);
            editorService.setMonaco(monaco);

            const model = editor.getModel();
            if (model && file.language) {
              monaco.editor.setModelLanguage(model, file.language);
            }

            editor.layout();

            editor.onDidFocusEditorText(() => {
              editorService.setActiveEditor(editor);
            });

            // Track live cursor position
            editor.onDidChangeCursorPosition((e: any) => {
              editorService.notifyCursorChange(e.position.lineNumber, e.position.column);
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
              const currentVal = editor.getValue();
              onChangeContent(file.path, currentVal);
              onSave(file.path);
            });
          }}
        />
      </div>
    </div>
  );
};

export const MonacoEditorGroup = React.memo(MonacoEditorGroupComponent);
