/**
 * sanitizeHtml.ts — Webview Trust Boundary & XSS Sanitizer (R5)
 * Strips active script tags, inline event handlers, and dangerous URL protocols
 * before inserting HTML into the DOM.
 *
 * Policy (shared by the DOMParser path and the regex fallback):
 * - Elements in DANGEROUS_TAGS are removed together with their children.
 * - on* handlers, srcdoc and ping are dropped.
 * - URL attributes must use an allowlisted scheme (http, https, mailto) or be
 *   relative/fragment; data: is accepted only for raster images in <img> src/srcset.
 * - CSS in attributes is dropped if it holds url() to a non-allowlisted scheme,
 *   expression(), -moz-binding, behavior:, @import or script schemes (escapes decoded first).
 */

const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "dialog",
  "template",
  "math",
  // Raw-text / parser-differential elements (mXSS: DOMParser parses with scripting off).
  "noscript",
  "noembed",
  "noframes",
  "xmp",
  "plaintext",
  "title",
  // SVG: HTML integration point and animation elements that can rewrite href.
  "foreignobject",
  "animate",
  "set",
  "animatemotion",
  "animatetransform",
  "animatecolor",
  "handler",
  "listener",
]);

const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "poster",
  "background",
  "cite",
  "data",
  "codebase",
  "classid",
  "archive",
  "longdesc",
  "lowsrc",
  "dynsrc",
  "manifest",
  "icon",
  "profile",
  "usemap",
]);

const DROP_ATTRS = new Set(["srcdoc", "ping"]);

const SAFE_SCHEMES = new Set(["http", "https", "mailto"]);
const RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp)[;,]/;

const NAMED_ENTITIES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  nbsp: "\u00a0",
  lpar: "(",
  rpar: ")",
  sol: "/",
  bsol: "\\",
  period: ".",
  comma: ",",
  semi: ";",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
};

/** Decodes numeric (&#106; &#x6A;, semicolon optional) and common named entities. */
function decodeEntities(str: string): string {
  return str.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));?/gi, (match, hex, dec, named) => {
    if (hex || dec) {
      const code = parseInt(hex ?? dec, hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[named.toLowerCase()] ?? match;
  });
}

/**
 * Normalizes a URL for scheme checks: decodes entities, strips whitespace and ASCII/C1
 * control chars (which browsers discard or which hide schemes), lowercases.
 */
function normalizeUrl(str: string): string {
  return decodeEntities(str)
    .replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200d\u2028\u2029\ufeff\s]/g, "")
    .toLowerCase();
}

/** Scheme allowlist check. Relative and fragment URLs are safe. */
export function isSafeUrl(value: string, allowRasterData = false): boolean {
  const norm = normalizeUrl(value);
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(norm)?.[1];
  if (!scheme) return true;
  if (SAFE_SCHEMES.has(scheme)) return true;
  return scheme === "data" && allowRasterData && RASTER_DATA_URL.test(norm);
}

/** Validates every candidate URL in a srcset (WHATWG candidate splitting). */
export function isSafeSrcset(value: string, allowRasterData = false): boolean {
  const s = decodeEntities(value);
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    let url = "";
    while (i < s.length && !/\s/.test(s[i])) url += s[i++];
    if (/,+$/.test(url)) {
      url = url.replace(/,+$/, "");
    } else {
      while (i < s.length && s[i] !== ",") i++; // skip descriptors
    }
    if (!isSafeUrl(url, allowRasterData)) return false;
  }
  return true;
}

/** Detects dangerous CSS (decodes entities, CSS escapes and comments first). */
export function isDangerousCss(value: string): boolean {
  const decoded = decodeEntities(value)
    .replace(/\\\r?\n/g, "")
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\\(.)/g, "$1")
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
  const compact = decoded.replace(/[\u0000-\u0020\u007f-\u009f\s]/g, "").toLowerCase();
  if (
    /expression\(|-moz-binding|behaviou?r:|@import|javascript:|vbscript:|livescript:/.test(compact)
  ) {
    return true;
  }
  for (const m of decoded.matchAll(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi)) {
    if (!isSafeUrl(m[2], true)) return true;
  }
  if (/image-set\(|(?:^|[^a-z-])src\(/.test(compact)) {
    for (const m of decoded.matchAll(/(['"])([\s\S]*?)\1/g)) {
      if (!isSafeUrl(m[2], true)) return true;
    }
  }
  return false;
}

/**
 * Shared attribute policy. Returns the value to keep, or null to drop the attribute.
 * `tag` and `name` must be lowercase.
 */
function filterAttr(tag: string, name: string, value: string): string | null {
  if (name.startsWith("on") || DROP_ATTRS.has(name)) return null;

  const allowRasterData = tag === "img";
  if (URL_ATTRS.has(name) || name.endsWith("href")) {
    if (!isSafeUrl(value, allowRasterData && name === "src")) return null;
    // <use> may only reference fragments in the same document.
    if (tag === "use" && !normalizeUrl(value).startsWith("#")) return null;
  } else if (name === "srcset" || name === "imagesrcset") {
    if (!isSafeSrcset(value, allowRasterData)) return null;
  }

  // CSS payloads: style attributes and SVG presentation attributes (fill="url(...)" etc.).
  if (isDangerousCss(value)) return null;
  return value;
}

const isLinkTag = (tag: string) => tag === "a" || tag === "area";

/** Applies the attribute policy to a live element (DOM path). */
function sanitizeElementAttrs(el: Element, tag: string): void {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const kept = filterAttr(tag, name, attr.value);
    if (kept === null) el.removeAttribute(attr.name);
  }
  if (isLinkTag(tag)) {
    el.setAttribute("target", "_blank");
    el.setAttribute("rel", "noopener noreferrer");
  }
}

const escapeAttr = (v: string) =>
  v.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TAG_NAMES_RE = Array.from(DANGEROUS_TAGS).join("|");
const DANGEROUS_BLOCK_RE = new RegExp(
  `<(${TAG_NAMES_RE})(?=[\\s/>])[\\s\\S]*?<\\/\\1\\s*>`,
  "gi"
);
const TAG_RE = /<(\/?)([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** One pass of the regex fallback (used only where DOMParser is unavailable). */
function fallbackPass(html: string): string {
  return html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<[!?][\s\S]*?>/g, "")
    .replace(/<plaintext\b[\s\S]*$/gi, "")
    .replace(DANGEROUS_BLOCK_RE, "")
    .replace(TAG_RE, (_m, slash: string, rawTag: string, rawAttrs: string) => {
      const tag = rawTag.toLowerCase();
      if (DANGEROUS_TAGS.has(tag)) return "";
      if (slash) return `</${tag}>`;
      const selfClose = /\/\s*$/.test(rawAttrs);
      let out = "";
      for (const m of rawAttrs.replace(/\/\s*$/, "").matchAll(ATTR_RE)) {
        const name = m[1].toLowerCase();
        if (isLinkTag(tag) && (name === "target" || name === "rel")) continue;
        const hasValue = m[2] !== undefined || m[3] !== undefined || m[4] !== undefined;
        // Raw (entity-encoded) value: the checks decode entities themselves, and the
        // re-serialized output keeps the author's entities so it renders unchanged.
        const value = m[2] ?? m[3] ?? m[4] ?? "";
        if (filterAttr(tag, name, value) === null) continue;
        out += hasValue ? ` ${name}="${escapeAttr(value)}"` : ` ${name}`;
      }
      if (isLinkTag(tag)) out += ' target="_blank" rel="noopener noreferrer"';
      return `<${tag}${out}${selfClose ? " /" : ""}>`;
    });
}

/**
 * Sanitizes an HTML string to prevent XSS attacks in the Tauri webview.
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") return "";
  if (typeof DOMParser === "undefined") {
    // Headless environments without DOMParser: regex fallback, repeated until stable so
    // removals cannot splice a new tag together (e.g. "<scr<script></script>ipt>").
    let out = rawHtml;
    for (let i = 0; i < 10; i++) {
      const next = fallbackPass(out);
      if (next === out) return out;
      out = next;
    }
    return out.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    for (const el of Array.from(doc.body.querySelectorAll("*"))) {
      if (!el.isConnected) continue; // inside an already-removed subtree
      const tag = el.localName.toLowerCase();
      if (DANGEROUS_TAGS.has(tag)) {
        el.remove();
        continue;
      }
      sanitizeElementAttrs(el, tag);
    }

    return doc.body.innerHTML;
  } catch (err) {
    console.warn("[CodeUI Sanitizer] Fallback due to parsing error:", err);
    return "";
  }
}
