import React from "react";
import Editor from "@monaco-editor/react";
import "../../editorRuntime";
import { MONACO_LAB_SAFE_OPTIONS, blockManualSuggestionShortcuts } from "./monacoSafeDefaults";
import { getEditorTheme } from "../../services/extensionHost";
import { OpenFile } from "../../types";
import { ChevronRight } from "lucide-react";
import { FileIcon } from "../icons/FileIcon";
import { editorService, getNormalizedUri } from "../../services/editorService";
import type * as Monaco from "../../monaco";

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
  const editorRef = React.useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = React.useRef<typeof Monaco | null>(null);
  const markersDisposableRef = React.useRef<Monaco.IDisposable | null>(null);

  // Live refs to prevent stale closure bugs (F6)
  const fileRef = React.useRef<OpenFile | undefined>(file);
  fileRef.current = file;

  const onSaveRef = React.useRef(onSave);
  onSaveRef.current = onSave;

  const onChangeContentRef = React.useRef(onChangeContent);
  onChangeContentRef.current = onChangeContent;

  const onCursorChangeRef = React.useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  const onMarkersChangeRef = React.useRef(onMarkersChange);
  onMarkersChangeRef.current = onMarkersChange;

  // Auto-focus editor whenever switching files (F7)
  React.useEffect(() => {
    if (editorRef.current && file?.path) {
      editorRef.current.focus();
    }
  }, [file?.path]);

  // Synchronize language if file type or language changes
  React.useEffect(() => {
    if (!editorRef.current || !monacoRef.current || !file?.language) return;
    const model = editorRef.current.getModel();
    if (model) {
      monacoRef.current.editor.setModelLanguage(model, file.language);
    }
  }, [file?.language]);

  // Clean up global listeners on unmount
  React.useEffect(() => {
    return () => {
      if (markersDisposableRef.current) {
        markersDisposableRef.current.dispose();
        markersDisposableRef.current = null;
      }
    };
  }, []);

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
        <span style={{ color: "var(--text-bright)" }}>
          {file.name.replace(/\.[^/.]+$/, "")}
        </span>
      </div>

      {/* Monaco Editor Container */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "var(--bg-editor)", minHeight: 0 }}>
        <Editor
          height="100%"
          path={getNormalizedUri(file.path)}
          language={file.language}
          defaultValue={file.content}
          theme={getEditorTheme()}
          keepCurrentModel={true}
          saveViewState={true}
          loading={<div style={{ height: "100%", width: "100%", background: "var(--bg-editor)" }} />}
          options={MONACO_LAB_SAFE_OPTIONS}
          onChange={(value) => {
            if (value !== undefined && fileRef.current?.path) {
              onChangeContentRef.current(fileRef.current.path, value);
            }
          }}
          onMount={(editor, monaco: typeof Monaco) => {
            editorRef.current = editor;
            monacoRef.current = monaco;
            monaco.editor.setTheme(getEditorTheme());
            editorService.setActiveEditor(editor);
            editorService.setMonaco(monaco);

            // Y1: Block all manual completion/hint shortcuts on the editor instance
            blockManualSuggestionShortcuts(editor, monaco);

            // R3: Guarantee character metrics match font before rendering
            monaco.editor.remeasureFonts();
            if (typeof document !== "undefined" && document.fonts?.ready) {
              document.fonts.ready.then(() => {
                monaco.editor.remeasureFonts();
                editor.layout();
              });
            }

            const model = editor.getModel();
            if (model && fileRef.current?.language) {
              monaco.editor.setModelLanguage(model, fileRef.current.language);
            }

            editor.focus();

            editor.onDidFocusEditorText(() => {
              editorService.setActiveEditor(editor);
            });

            // Closing the split (or the last tab) disposes this editor: menu actions,
            // Find and Go to Line must move to the editor that is still on screen.
            editor.onDidDispose(() => {
              if (editorService.getActiveEditor() === editor) {
                const other = monaco.editor.getEditors().find((e) => e !== editor);
                editorService.setActiveEditor((other as Monaco.editor.IStandaloneCodeEditor | undefined) ?? null);
              }
            });

            // Track live cursor position
            editor.onDidChangeCursorPosition((e) => {
              editorService.notifyCursorChange(e.position.lineNumber, e.position.column);
              onCursorChangeRef.current?.(e.position.lineNumber, e.position.column);
            });

            // Track live diagnostics / syntax errors & warnings
            const updateMarkers = () => {
              const currentModel = editor.getModel();
              const currentMonaco = monacoRef.current;
              if (currentModel && currentMonaco) {
                const markers = currentMonaco.editor.getModelMarkers({ resource: currentModel.uri });
                const errors = markers.filter((m) => m.severity === currentMonaco.MarkerSeverity.Error).length;
                const warnings = markers.filter((m) => m.severity === currentMonaco.MarkerSeverity.Warning).length;
                onMarkersChangeRef.current?.(errors, warnings);
              }
            };

            if (markersDisposableRef.current) {
              markersDisposableRef.current.dispose();
            }
            markersDisposableRef.current = monaco.editor.onDidChangeMarkers(() => {
              updateMarkers();
            });
            updateMarkers();

            // Ctrl+S keybinding: resolve active model dynamically (F6 fix)
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              const activeModel = editor.getModel();
              const currentPath = fileRef.current?.path;
              if (activeModel && currentPath) {
                const currentVal = activeModel.getValue();
                onChangeContentRef.current(currentPath, currentVal);
                onSaveRef.current(currentPath);
              }
            });
          }}
        />
      </div>
    </div>
  );
};

export const MonacoEditorGroup = React.memo(MonacoEditorGroupComponent);
