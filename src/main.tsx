import ReactDOM from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { registerAllEagerLanguages } from "./languages/registerAllLanguages";
import { App } from "./App";
import { ensureMonacoFontsReady } from "./utils/fontCheck";
import "./index.css";

// Import Monaco workers directly using Vite ?worker syntax.
// This bundles workers into self-contained classic scripts compatible with
// Tauri's custom URI schemes and WebView2 without failing module-worker restrictions.
import editorWorker from "../node_modules/monaco-editor/esm/vs/editor/editor.worker.js?worker";
import jsonWorker from "../node_modules/monaco-editor/esm/vs/language/json/json.worker.js?worker";
import cssWorker from "../node_modules/monaco-editor/esm/vs/language/css/css.worker.js?worker";
import htmlWorker from "../node_modules/monaco-editor/esm/vs/language/html/html.worker.js?worker";
import tsWorker from "../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

// Register all core languages and tokenizers eagerly
try {
  registerAllEagerLanguages(monaco);
} catch (e) {
  console.error("Failed to register eager languages:", e);
}

// Strict lab-safe lockdown: disable all built-in completion, hover, and suggestion engines (F14)
try {
  const noAssistance = {
    completionItems: false,
    hovers: false,
    documentHighlights: false,
    definitions: false,
    referenceProviders: false,
    documentSymbols: false,
    signatureHelp: false,
    rename: false,
    colors: false,
    folding: false,
    selectionRanges: false,
    documentFormattingEdits: false,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false,
    diagnostics: false,
  };
  (monaco.languages as any).typescript?.typescriptDefaults?.setModeConfiguration(noAssistance);
  (monaco.languages as any).typescript?.javascriptDefaults?.setModeConfiguration(noAssistance);
  (monaco.languages as any).css?.cssDefaults?.setModeConfiguration({
    completionItems: false,
    hovers: false,
    documentHighlights: false,
    documentSymbols: false,
    colors: false,
    folding: false,
    diagnostics: false,
  });
  (monaco.languages as any).html?.htmlDefaults?.setModeConfiguration({
    completionItems: false,
    hovers: false,
    documentHighlights: false,
    documentSymbols: false,
    colors: false,
    folding: false,
  });
  (monaco.languages as any).json?.jsonDefaults?.setModeConfiguration({
    completionItems: false,
    hovers: false,
    documentSymbols: false,
    colors: false,
    folding: false,
    diagnostics: false,
  });
} catch (err) {
  console.warn("Failed to apply lab-safe mode configuration:", err);
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
  getWorker(_, label) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

// Use the locally bundled Monaco instead of loading from CDN
// (Tauri CSP blocks external script loading)
loader.config({ monaco });

// Prevent accidental pinch-zoom or Ctrl+wheel scaling that breaks Monaco layout coordinates
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  },
  { passive: false }
);

window.addEventListener("gesturestart", (e) => e.preventDefault());
window.addEventListener("gesturechange", (e) => e.preventDefault());
window.addEventListener("gestureend", (e) => e.preventDefault());

// In production builds, disable right-click inspect and DevTools shortcuts (R5)
if (import.meta.env.PROD) {
  window.addEventListener("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest("input, textarea, [contenteditable='true']")) {
      e.preventDefault();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (
      e.key === "F12" ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "i", "J", "j", "C", "c"].includes(e.key)) ||
      ((e.ctrlKey || e.metaKey) && ["U", "u"].includes(e.key))
    ) {
      e.preventDefault();
    }
  });
}

// Ensure Monaco line and character measurements match after font readiness
async function initApp() {
  await ensureMonacoFontsReady(monaco);

  // Remeasure fonts if devicePixelRatio / monitor DPI changes
  if (window.matchMedia) {
    try {
      window.matchMedia("(resolution: 1dppx)").addEventListener("change", () => {
        monaco.editor.remeasureFonts();
      });
    } catch {}
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <App />
  );
}

initApp();
