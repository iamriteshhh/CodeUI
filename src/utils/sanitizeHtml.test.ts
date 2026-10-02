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

  it("strips iframes and objects", () => {
    const dirty = '<iframe src="https://evil.com"></iframe><object data="malware.swf"></object>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("<iframe");
    expect(clean).not.toContain("<object");
  });
});
