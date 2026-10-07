// Monaco setup, loaded in parallel with (not before) the first paint of the app shell.
import { loader } from "@monaco-editor/react";
import * as monaco from "./monaco";
import { registerAllEagerLanguages } from "./languages/registerAllLanguages";
import { ensureMonacoFontsReady } from "./utils/fontCheck";
import { applyZeroSuggestionsLockdown } from "./components/editor/monacoSafeDefaults";
import { getEditorTheme } from "./services/extensionHost";
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

// Define clean high-contrast light theme with guaranteed token colors
monaco.editor.defineTheme("codeui-light", {
  base: "vs",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "0000ff", fontStyle: "bold" },
    { token: "keyword.flow", foreground: "af00db", fontStyle: "bold" },
    { token: "keyword.directive", foreground: "001080" },
    { token: "keyword.directive.include", foreground: "0000ff" },
    { token: "type", foreground: "267f99" },
    { token: "type.identifier", foreground: "267f99" },
    { token: "string", foreground: "a31515" },
    { token: "string.escape", foreground: "ee0000" },
    { token: "string.target", foreground: "001080" },
    { token: "number", foreground: "098658" },
    { token: "number.float", foreground: "098658" },
    { token: "number.hex", foreground: "098658" },
    { token: "comment", foreground: "008000", fontStyle: "italic" },
    { token: "operator", foreground: "000000" },
    { token: "operator.arrow", foreground: "0000ff" },
    { token: "delimiter", foreground: "000000" },
    { token: "identifier", foreground: "001080" },
    { token: "predefined", foreground: "795e26" },
    { token: "variable", foreground: "001080" },
    { token: "variable.predefined", foreground: "267f99" },
    { token: "annotation", foreground: "795e26" },
    // TextMate scopes (grammars from installed extensions and built-in Salivo)
    { token: "keyword.control", foreground: "af00db" },
    { token: "keyword.operator", foreground: "000000" },
    { token: "storage", foreground: "0000ff" },
    { token: "storage.type", foreground: "0000ff" },
    { token: "storage.modifier", foreground: "0000ff" },
    { token: "constant.numeric", foreground: "098658" },
    { token: "constant.language", foreground: "0000ff" },
    { token: "constant.character.escape", foreground: "ee0000" },
    { token: "constant.other", foreground: "0070c1" },
    { token: "entity.name.function", foreground: "795e26" },
    { token: "entity.name.type", foreground: "267f99" },
    { token: "entity.name.class", foreground: "267f99" },
    { token: "entity.name.namespace", foreground: "267f99" },
    { token: "entity.name.tag", foreground: "800000" },
    { token: "entity.other.attribute-name", foreground: "e50000" },
    { token: "entity.other.inherited-class", foreground: "267f99" },
    { token: "support.function", foreground: "795e26" },
    { token: "support.type", foreground: "267f99" },
    { token: "support.class", foreground: "267f99" },
    { token: "variable.parameter", foreground: "001080" },
    { token: "variable.language", foreground: "0000ff" },
    { token: "markup.heading", foreground: "0000ff", fontStyle: "bold" },
    { token: "invalid", foreground: "cd3131" },
  ],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#1e1e1e",
    "editorCursor.foreground": "#000000",
    "editorCursor.background": "#ffffff",
    "editor.selectionBackground": "#add6ff",
    "editor.inactiveSelectionBackground": "#e5ebf1",
    "editorLineNumber.foreground": "#747474",
    "editorLineNumber.activeForeground": "#000000",
    "editor.lineHighlightBackground": "#f8f8f8",
    "editor.lineHighlightBorder": "#f8f8f800",
    "editorGutter.background": "#ffffff",
  },
});

monaco.editor.setTheme(getEditorTheme());

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
