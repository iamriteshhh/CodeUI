import { describe, it, expect } from "vitest";
import { sanitizeHtml, isSafeUrl, isSafeSrcset, isDangerousCss } from "./sanitizeHtml";

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

describe("sanitizeHtml URL / SVG / CSS hardening", () => {
  it("allowlists URL schemes with entity, whitespace and case obfuscation", () => {
    const bad = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "java\tscript:alert(1)",
      "\u0000javascript:alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;avascript:alert(1)",
      "&#0000106avascript:alert(1)",
      "javascript&colon;alert(1)",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "tauri://localhost/x",
      "ipc://localhost/cmd",
      "asset://localhost/C:/secret",
      "data:text/html,<script>alert(1)</script>",
      "data:image/svg+xml,<svg onload=alert(1)>",
    ];
    for (const url of bad) expect(isSafeUrl(url, true), url).toBe(false);
    for (const url of ["https://a.b/c", "http://x", "mailto:a@b.c", "/rel", "rel/x.png", "#frag", "?q=1"]) {
      expect(isSafeUrl(url), url).toBe(true);
    }
    expect(isSafeUrl("data:image/png;base64,iVBORw0KGgo=", true)).toBe(true);
    expect(isSafeUrl("data:image/png;base64,iVBORw0KGgo=", false)).toBe(false);
  });

  it("drops obfuscated javascript: hrefs end-to-end", () => {
    const dirty =
      '<a href="&#106;avascript:evil1()">a</a><a href="JaVaScRiPt:evil2()">b</a>' +
      "<a href='java&#x09;script:evil3()'>c</a><a href=javascript&colon;evil4()>d</a>";
    const clean = sanitizeHtml(dirty);
    for (const n of [1, 2, 3, 4]) expect(clean).not.toContain(`evil${n}`);
    expect(clean).toContain(">a</a>");
  });

  it("blocks data:text/html and data:image/svg+xml, keeps raster data images", () => {
    const clean = sanitizeHtml(
      '<a href="data:text/html,<script>alert(1)</script>">x</a>' +
        '<img src="data:image/svg+xml;base64,PHN2Zz4=">' +
        '<img src="data:image/png;base64,iVBORw0KGgo=">'
    );
    expect(clean).not.toContain("data:text/html");
    expect(clean).not.toContain("svg+xml");
    expect(clean).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("neutralizes SVG payloads (onload, animate/set href, foreignObject, external use)", () => {
    const dirty =
      '<svg onload="alert(1)"><a><animate attributeName="href" values="javascript:alert(2)"/>' +
      '<set attributeName="xlink:href" to="javascript:alert(3)"/><text>T</text></a>' +
      '<foreignObject><iframe srcdoc="<script>alert(4)</script>"></iframe></foreignObject>' +
      '<use href="https://evil.example/x.svg#a"/><use xlink:href="data:image/svg+xml,<svg/onload=alert(5)>"/>' +
      '<use href="#ok"/><circle onclick="alert(6)" r="1"/></svg>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/alert|onload|onclick|animate|<set|foreignobject|evil\.example/i);
    expect(clean).toContain('href="#ok"');
    expect(clean).toContain("<text>T</text>");
  });

  it("drops dangerous CSS (url(javascript:), escapes, expression, -moz-binding, behavior, @import)", () => {
    for (const css of [
      "background:url(javascript:alert(1))",
      "background:url('JaVa\\53 cript:alert(1)')",
      "background:u\\72l(javascript:alert(1))",
      "background:\\75\\72\\6c(\\6a avascript:alert(1))",
      "width:expression(alert(1))",
      "width:expr/**/ession(alert(1))",
      "-moz-binding:url(https://evil/x.xml#x)",
      "behavior:url(x.htc)",
      "@import 'https://evil/x.css'",
      "background:url(tauri://localhost/x)",
      "background:url(data:image/svg+xml,x)",
      "background-image:image-set('javascript:x' 1x)",
    ]) {
      expect(isDangerousCss(css), css).toBe(true);
    }
    expect(isDangerousCss("color: red; background: url(https://a.b/c.png)")).toBe(false);
    const clean = sanitizeHtml(
      '<p style="background:url(javascript:alert(1))">x</p><svg><rect fill="url(javascript:alert(2))"/></svg>'
    );
    expect(clean).not.toContain("alert");
  });

  it("strips <style> blocks including @import", () => {
    const clean = sanitizeHtml('<style>@import url("https://evil/x.css"); body{}</style><p>ok</p>');
    expect(clean).not.toContain("@import");
    expect(clean).not.toContain("<style");
    expect(clean).toContain("<p>ok</p>");
  });

  it("rejects srcset with any bad candidate, keeps good srcset", () => {
    expect(isSafeSrcset("a.png 1x, https://x/b.png 2x")).toBe(true);
    expect(isSafeSrcset("a.png 1x, javascript:alert(1) 2x")).toBe(false);
    expect(isSafeSrcset("a.png 1x,data:text/html,x 2x", true)).toBe(false);
    const clean = sanitizeHtml('<img src="a.png" srcset="a.png 1x, javascript:alert(1) 2x">');
    expect(clean).not.toContain("srcset");
    expect(clean).toContain('src="a.png"');
  });

  it("removes meta refresh, base, link, and iframe/form escape attempts", () => {
    const dirty =
      '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">' +
      '<base href="https://evil.example/"><link rel="import" href="https://evil.example/x">' +
      '<a href="https://ok.example" target="_top">top</a>' +
      '<form action="https://evil.example"><button formaction="javascript:alert(2)">go</button></form>' +
      '<iframe src="https://evil.example"></iframe><object data="x"></object><embed src="x">';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toMatch(/<meta|<base|<link|<form|<button|<iframe|<object|<embed|_top|alert|evil/i);
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });

  it("drops mXSS raw-text containers and spliced tags", () => {
    const clean = sanitizeHtml(
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>' +
        "<scr<script>x</script>ipt>alert(2)</script><img/src=x/onerror=alert(3)>"
    );
    expect(clean).not.toMatch(/<script|<noscript|\sonerror\s*=/i);
  });

  it("keeps benign HTML intact", () => {
    const dirty =
      '<h1>Title</h1><p style="color: red; font-weight: bold">Hi <b>there</b></p>' +
      '<a href="https://example.com/docs?a=1&amp;b=2#x">docs</a>' +
      '<img src="https://example.com/i.png" alt="pic"><img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">' +
      '<a href="#section">jump</a><a href="mailto:a@b.c">mail</a>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain("<h1>Title</h1>");
    expect(clean).toContain('style="color: red; font-weight: bold"');
    expect(clean).toContain('href="https://example.com/docs?a=1&amp;b=2#x"');
    expect(clean).toContain('src="https://example.com/i.png"');
    expect(clean).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(clean).toContain('href="#section"');
    expect(clean).toContain('href="mailto:a@b.c"');
  });
});
