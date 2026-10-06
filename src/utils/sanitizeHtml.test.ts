import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "./sanitizeHtml";

describe("sanitizeHtml Webview Security (R5)", () => {
  it("strips active script tags", () => {
    const dirty = '<div>Hello</div><script>window.__TAURI_INTERNALS__.invoke("delete_file")</script>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("__TAURI_INTERNALS__");
    expect(clean).toContain("Hello");
  });

  it("strips inline onerror / onload event handlers", () => {
    const dirty = '<img src="x" onerror="alert(1)" onload="alert(2)" />Safe Text';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("onload");
    expect(clean).toContain("Safe Text");
  });

  it("neutralizes javascript: URLs in href attributes", () => {
    const dirty = '<a href="javascript:doEvil()">Click here</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("javascript:doEvil()");
  });

  it("neutralizes obfuscated javascript: URLs with embedded control chars/whitespace", () => {
    const dirty = '<a href="java\nscript:doEvil()">Click</a><a href="  javascript:doEvil()">Click2</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("doEvil()");
  });

  it("neutralizes SVG xlink:href and dangerous protocols", () => {
    const dirty = '<svg><a xlink:href="javascript:evil()"><text>SVG Link</text></a></svg>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("javascript:evil()");
    expect(clean).not.toContain("evil()");
  });

  it("neutralizes vbscript: and file: protocol schemes", () => {
    const dirty = '<a href="vbscript:msgbox(1)">VB</a><a href="file:///etc/passwd">Local</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("vbscript:msgbox(1)");
    expect(clean).not.toContain("file:///etc/passwd");
  });

  it("strips iframes, objects, templates, and math tags", () => {
    const dirty = '<iframe src="https://evil.com"></iframe><object data="malware.swf"></object><template><script>x</script></template><math></math>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<object");
    expect(clean).not.toContain("<template");
    expect(clean).not.toContain("<math");
  });
});
