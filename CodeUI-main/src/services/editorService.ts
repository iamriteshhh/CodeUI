// Monaco editor service for dispatching Edit and Selection commands

type AnyEditor = any;

let activeEditorInstance: AnyEditor | null = null;
let monacoInstance: any = null;
type CursorCallback = (line: number, col: number) => void;
const cursorCallbacks: CursorCallback[] = [];

export const editorService = {
  setActiveEditor(editor: AnyEditor | null) {
    activeEditorInstance = editor;
  },

  setMonaco(monaco: any) {
    monacoInstance = monaco;
  },

  onCursorChange(cb: CursorCallback) {
    cursorCallbacks.push(cb);
    return () => {
      const idx = cursorCallbacks.indexOf(cb);
      if (idx !== -1) cursorCallbacks.splice(idx, 1);
    };
  },

  notifyCursorChange(line: number, col: number) {
    for (const cb of cursorCallbacks) {
      cb(line, col);
    }
  },

  setLanguage(languageId: string) {
    if (!activeEditorInstance) return;
    const model = activeEditorInstance.getModel();
    if (model && monacoInstance) {
      monacoInstance.editor.setModelLanguage(model, languageId.toLowerCase());
    }
  },

  setTabSize(tabSize: number) {
    if (!activeEditorInstance) return;
    const model = activeEditorInstance.getModel();
    if (model) {
      model.updateOptions({ tabSize, insertSpaces: true });
    }
  },

  getActiveEditor(): AnyEditor | null {
    return activeEditorInstance;
  },

<<<<<<< HEAD:CodeUI-main/src/services/editorService.ts
  getText(path: string): string | null {
    if (!monacoInstance) return null;
    try {
      const uriStr = getNormalizedUri(path);
      const uri = monacoInstance.Uri.parse(uriStr);
      const model = monacoInstance.editor.getModel(uri);
      return model ? model.getValue() : null;
    } catch {
      return null;
    }
  },

  focusActive() {
    if (activeEditorInstance) {
      activeEditorInstance.focus();
    }
  },

  layout() {
    if (activeEditorInstance) {
      activeEditorInstance.layout();
    }
  },

=======
>>>>>>> 66b6de40caf85349a094aaf1377b064cfc6d6bf6:src/services/editorService.ts
  undo() {
    if (!activeEditorInstance) return;
    activeEditorInstance.trigger("titlebar", "undo", null);
    activeEditorInstance.focus();
  },

  redo() {
    if (!activeEditorInstance) return;
    activeEditorInstance.trigger("titlebar", "redo", null);
    activeEditorInstance.focus();
  },

  cut() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    document.execCommand("cut");
  },

  copy() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    document.execCommand("copy");
  },

  async paste() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          activeEditorInstance.trigger("keyboard", "type", { text });
        }
      }
    } catch {
      document.execCommand("paste");
    }
  },

  find() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    const action = activeEditorInstance.getAction("actions.find");
    if (action) {
      action.run();
    }
  },

  replace() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    const action = activeEditorInstance.getAction("editor.action.startFindReplaceAction");
    if (action) {
      action.run();
    }
  },

  selectAll() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    const action = activeEditorInstance.getAction("editor.action.selectAll");
    if (action) {
      action.run();
    }
  },

  copyLineUp() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    const action = activeEditorInstance.getAction("editor.action.copyLinesUpAction");
    if (action) {
      action.run();
    }
  },

  copyLineDown() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    const action = activeEditorInstance.getAction("editor.action.copyLinesDownAction");
    if (action) {
      action.run();
    }
  },

  gotoLine() {
    if (!activeEditorInstance) return;
    activeEditorInstance.focus();
    const action = activeEditorInstance.getAction("editor.action.gotoLine");
    if (action) {
      action.run();
    }
  },

  revealLine(lineNumber: number) {
    if (!activeEditorInstance) return;
    activeEditorInstance.revealLineInCenter(lineNumber);
    activeEditorInstance.setPosition({ lineNumber, column: 1 });
    activeEditorInstance.focus();
  },

  disposeModel(path: string) {
    if (!monacoInstance) return;
    try {
      const uriStr = getNormalizedUri(path);
      const uri = monacoInstance.Uri.parse(uriStr);
      const model = monacoInstance.editor.getModel(uri);
      if (model) {
        model.dispose();
      }
    } catch {
      // ignore URI parsing errors
    }
  },
<<<<<<< HEAD:CodeUI-main/src/services/editorService.ts

  setMarkers(path: string, diagnostics: Array<{ line: number; column?: number; message: string; severity: "error" | "warning" | "info" }>) {
    if (!monacoInstance) return;
    try {
      const uriStr = getNormalizedUri(path);
      const uri = monacoInstance.Uri.parse(uriStr);
      const model = monacoInstance.editor.getModel(uri);
      if (!model) return;

      const markers = diagnostics.map((d) => ({
        severity:
          d.severity === "warning"
            ? monacoInstance.MarkerSeverity.Warning
            : d.severity === "info"
            ? monacoInstance.MarkerSeverity.Info
            : monacoInstance.MarkerSeverity.Error,
        message: d.message,
        startLineNumber: d.line,
        startColumn: d.column || 1,
        endLineNumber: d.line,
        endColumn: d.column ? d.column + 1 : model.getLineMaxColumn(d.line),
      }));

      monacoInstance.editor.setModelMarkers(model, "codeui-compiler", markers);
    } catch (err) {
      console.error("Failed to set model markers:", err);
    }
  },

  clearMarkers(path: string) {
    if (!monacoInstance) return;
    try {
      const uriStr = getNormalizedUri(path);
      const uri = monacoInstance.Uri.parse(uriStr);
      const model = monacoInstance.editor.getModel(uri);
      if (model) {
        monacoInstance.editor.setModelMarkers(model, "codeui-compiler", []);
      }
    } catch {}
  },
=======
>>>>>>> 66b6de40caf85349a094aaf1377b064cfc6d6bf6:src/services/editorService.ts
};

export function getNormalizedUri(filePath: string): string {
  if (!filePath) return "inmemory://default";
  if (filePath.startsWith("file://")) return filePath;
  const clean = filePath.replace(/\\/g, "/");
  return `file:///${clean.replace(/^\/+/, "")}`;
}

