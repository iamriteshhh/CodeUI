import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";

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

function initApp() {
  // Desktop Application Guard (Y8):
  // CodeUI is strictly a desktop application. If running a production build outside of
  // Tauri's native webview container, display a fatal desktop-required notice.
  const isDesktopRuntime =
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

  if (import.meta.env.PROD && !isDesktopRuntime) {
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#181818;color:#f0f6fc;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:32px;text-align:center;">
          <div style="font-size:44px;margin-bottom:16px;">🖥️</div>
          <h1 style="font-size:20px;font-weight:600;margin-bottom:12px;color:#f85149;">Desktop Application Required</h1>
          <p style="max-width:520px;line-height:1.6;color:#8c8c8c;font-size:13px;margin-bottom:24px;">
            CodeUI is an offline, lab-safe code editor engineered exclusively for native desktop execution.
            Standalone web browser access is disabled in production because browser sandboxes cannot access native toolchains or supervised execution PTYs.
          </p>
          <div style="background:#202020;border:1px solid #333;padding:10px 18px;border-radius:6px;font-family:monospace;font-size:12px;color:#4ec9b0;">
            Launch CodeUI from your desktop or start via: npm run tauri dev
          </div>
        </div>
      `;
    }
    return;
  }

  // Start fetching the editor now, but paint the shell without waiting for it.
  import("./editorRuntime");

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <App />
  );
}

initApp();
