// Monaco setup, loaded in parallel with (not before) the first paint of the app shell.
import { loader } from "@monaco-editor/react";
import * as monaco from "./monaco";
import { registerAllEagerLanguages } from "./languages/registerAllLanguages";
import { ensureMonacoFontsReady } from "./utils/fontCheck";
import { applyZeroSuggestionsLockdown } from "./components/editor/monacoSafeDefaults";
// Only the generic editor worker: language-service workers are not bundled (no suggestions).
import editorWorker from "monaco-editor/editor/editor.worker.js?worker";

// Strict lab-safe lockdown: neutralize all completion, hover, and suggestion engines (Y1).
// Runs before language registration so nothing registered there can slip through.
try {
  applyZeroSuggestionsLockdown(monaco);
} catch (err) {
  console.warn("Failed to apply zero-suggestions lockdown:", err);
}

// Register all core languages and tokenizers eagerly
try {
  registerAllEagerLanguages(monaco);
} catch (e) {
  console.error("Failed to register eager languages:", e);
}

// Define vibrant high-contrast dark theme with guaranteed token colors
monaco.editor.defineTheme("codeui-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "569cd6", fontStyle: "bold" },
    { token: "keyword.flow", foreground: "c586c0", fontStyle: "bold" },
    { token: "keyword.directive", foreground: "9cdcfe" },
    { token: "keyword.directive.include", foreground: "569cd6" },
    { token: "type", foreground: "4ec9b0" },
    { token: "type.identifier", foreground: "4ec9b0" },
    { token: "string", foreground: "ce9178" },
    { token: "string.escape", foreground: "d7ba7d" },
    { token: "string.target", foreground: "9cdcfe" },
    { token: "number", foreground: "b5cea8" },
    { token: "number.float", foreground: "b5cea8" },
    { token: "number.hex", foreground: "b5cea8" },
    { token: "comment", foreground: "6a9955", fontStyle: "italic" },
    { token: "operator", foreground: "d4d4d4" },
    { token: "operator.arrow", foreground: "569cd6" },
    { token: "delimiter", foreground: "d4d4d4" },
    { token: "identifier", foreground: "9cdcfe" },
    { token: "predefined", foreground: "dcdcaa" },
    { token: "variable", foreground: "9cdcfe" },
    { token: "variable.predefined", foreground: "4ec9b0" },
    { token: "annotation", foreground: "dcdcaa" },
    // TextMate scopes (grammars from installed extensions and built-in Salivo)
    { token: "keyword.control", foreground: "c586c0" },
    { token: "keyword.operator", foreground: "d4d4d4" },
    { token: "storage", foreground: "569cd6" },
    { token: "storage.type", foreground: "569cd6" },
    { token: "storage.modifier", foreground: "569cd6" },
    { token: "constant.numeric", foreground: "b5cea8" },
    { token: "constant.language", foreground: "569cd6" },
    { token: "constant.character.escape", foreground: "d7ba7d" },
    { token: "constant.other", foreground: "4fc1ff" },
    { token: "entity.name.function", foreground: "dcdcaa" },
    { token: "entity.name.type", foreground: "4ec9b0" },
    { token: "entity.name.class", foreground: "4ec9b0" },
    { token: "entity.name.namespace", foreground: "4ec9b0" },
    { token: "entity.name.tag", foreground: "569cd6" },
    { token: "entity.other.attribute-name", foreground: "9cdcfe" },
    { token: "entity.other.inherited-class", foreground: "4ec9b0" },
    { token: "support.function", foreground: "dcdcaa" },
    { token: "support.type", foreground: "4ec9b0" },
    { token: "support.class", foreground: "4ec9b0" },
    { token: "variable.parameter", foreground: "9cdcfe" },
    { token: "variable.language", foreground: "569cd6" },
    { token: "markup.heading", foreground: "569cd6", fontStyle: "bold" },
    { token: "invalid", foreground: "f44747" },
  ],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#d4d4d4",
    "editorCursor.foreground": "#ffffff",
    "editorCursor.background": "#1e1e1e",
    "editor.selectionBackground": "#264f78",
    "editor.inactiveSelectionBackground": "#3a3d41",
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#ffffff",
    "editor.lineHighlightBackground": "#282828",
    "editor.lineHighlightBorder": "#28282800",
    "editorGutter.background": "#1e1e1e",
  },
});
monaco.editor.setTheme("codeui-dark");

// Configure Monaco web workers via Vite ?worker constructors
self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

// Use the locally bundled Monaco instead of loading from CDN
// (Tauri CSP blocks external script loading)
loader.config({ monaco });

// Ensure Monaco line and character measurements match after font readiness
ensureMonacoFontsReady(monaco);

// Remeasure fonts if devicePixelRatio / monitor DPI changes
if (window.matchMedia) {
  try {
    window.matchMedia("(resolution: 1dppx)").addEventListener("change", () => {
      monaco.editor.remeasureFonts();
    });
  } catch {}
}
