import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewPanel } from "./PreviewPanel";

describe("PreviewPanel Trust Boundary (R5)", () => {
  it("enforces strict iframe sandbox without allow-same-origin", () => {
    const openFiles = [
      {
        path: "/test/index.html",
        name: "index.html",
        content: "<h1>Hello Sandboxed</h1>",
        language: "html",
        isDirty: false,
      },
    ];

    const markup = renderToStaticMarkup(
      <PreviewPanel openFiles={openFiles} activeFilePath="/test/index.html" />
    );

    expect(markup).toContain("<iframe");
    expect(markup).toContain('sandbox="allow-scripts allow-modals"');
    // Must NEVER contain allow-same-origin or allow-top-navigation to prevent Tauri IPC bypass
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).not.toContain("allow-top-navigation");
  });
});
