import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewPanel, PREVIEW_CSP, withPreviewCsp } from "./PreviewPanel";

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

describe("PreviewPanel CSP defense-in-depth", () => {
  const META = '<meta http-equiv="Content-Security-Policy"';

  it("injects CSP meta into srcdoc while keeping scripts runnable in the sandbox", () => {
    const openFiles = [
      {
        path: "/test/index.html",
        name: "index.html",
        content: "<!DOCTYPE html><html><head><title>t</title></head><body><script>1</script></body></html>",
        language: "html",
        isDirty: false,
      },
    ];
    const markup = renderToStaticMarkup(
      <PreviewPanel openFiles={openFiles} activeFilePath="/test/index.html" />
    );
    expect(markup).toContain("Content-Security-Policy");
    expect(markup).toContain('sandbox="allow-scripts allow-modals"');
    expect(markup).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
  });

  it("places the meta inside <head>, after doctype, or first — never before doctype", () => {
    expect(withPreviewCsp('<!doctype html><html><head lang="x"><title>t</title>')).toMatch(
      /^<!doctype html><html><head lang="x"><meta http-equiv="Content-Security-Policy"/
    );
    expect(withPreviewCsp("<!DOCTYPE html><p>x</p>")).toMatch(/^<!DOCTYPE html><meta /);
    expect(withPreviewCsp("<header>x</header>").startsWith(META)).toBe(true);
    expect(withPreviewCsp("<p>x</p>")).toBe(
      `${META} content="${PREVIEW_CSP}"><p>x</p>`
    );
  });

  it("policy blocks app-internal schemes and IPC fetches, allows inline student code", () => {
    expect(PREVIEW_CSP).toContain("'unsafe-inline'");
    expect(PREVIEW_CSP).toMatch(/connect-src https: wss:/);
    expect(PREVIEW_CSP).toContain("object-src 'none'");
    expect(PREVIEW_CSP).not.toMatch(/tauri:|ipc:|asset:|file:|\*/);
    expect(PREVIEW_CSP).not.toContain('"');
  });
});
