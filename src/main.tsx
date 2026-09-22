import React from "react";
import ReactDOM from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { App } from "./App";
import "./index.css";

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
