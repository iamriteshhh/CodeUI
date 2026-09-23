import React from "react";
import ReactDOM from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { registerSalivoLanguage } from "./languages/salivoMonaco";
import { App } from "./App";
import "./index.css";

// Register custom languages eagerly
registerSalivoLanguage(monaco);

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
    "editorLineNumber.foreground": "#858585",
    "editorLineNumber.activeForeground": "#ffffff",
    "editor.lineHighlightBackground": "#282828",
    "editor.lineHighlightBorder": "#28282800",
    "editorGutter.background": "#1e1e1e",
  },
});
monaco.editor.setTheme("codeui-dark");

// Configure Monaco web workers for local bundling (Vite)
// Using new URL() + import.meta.url pattern for Vite compatibility
self.MonacoEnvironment = {
  getWorker(_, label) {
    if (label === "json") {
      return new Worker(
        new URL("../node_modules/monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
        { type: "module" }
      );
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new Worker(
        new URL("../node_modules/monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
        { type: "module" }
      );
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new Worker(
        new URL("../node_modules/monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
        { type: "module" }
      );
    }
    if (label === "typescript" || label === "javascript") {
      return new Worker(
        new URL("../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
        { type: "module" }
      );
    }
    return new Worker(
      new URL("../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
      { type: "module" }
    );
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

// Ensure Monaco line and character measurements match after web fonts load
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => {
    monaco.editor.remeasureFonts();
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
