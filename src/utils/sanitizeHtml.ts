/**
 * sanitizeHtml.ts — Webview Trust Boundary & XSS Sanitizer (R5)
 * Strips active script tags, inline event handlers, and dangerous URL protocols
 * before inserting HTML into the DOM.
 */

const DANGEROUS_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "object",
  "embed",
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
]);

/**
 * Normalizes protocol strings by stripping whitespace and ASCII control chars (0x00-0x20, 0x7F-0x9F)
 * which browser parsers discard before determining scheme.
 */
function normalizeProtocol(str: string): string {
  return str.replace(/[\u0000-\u0020\u007f-\u009f\s]/g, "").toLowerCase();
}

/**
 * Checks if a URL value uses a dangerous scheme (javascript:, vbscript:, file:, or non-image data:).
 */
function isDangerousUrl(value: string, isSrc = false): boolean {
  const norm = normalizeProtocol(value);
  if (
    norm.startsWith("javascript:") ||
    norm.startsWith("vbscript:") ||
    norm.startsWith("file:")
  ) {
    return true;
  }
  if (norm.startsWith("data:")) {
    return !isSrc || !norm.startsWith("data:image/");
  }
  return false;
}

/**
 * Sanitizes an HTML string to prevent XSS attacks in the Tauri webview.
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") return "";
  if (typeof DOMParser === "undefined") {
    // In headless Node test environments without DOMParser, strip dangerous tags and protocols
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, "")
      .replace(/<\/?(iframe|object|embed|meta|link|base|form|input|button|dialog|math)\b[^>]*>/gi, "")
      .replace(/\bon\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/(?:href|xlink:href|src|action|formaction|srcdoc|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, q1, q2, q3) => {
        const val = q1 ?? q2 ?? q3 ?? "";
        if (isDangerousUrl(val, match.toLowerCase().startsWith("src"))) {
          return 'href="#"';
        }
        return match;
      });
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, "text/html");

    // Remove dangerous tags
    const allElements = Array.from(doc.body.querySelectorAll("*"));
    for (const el of allElements) {
      const tagName = el.tagName.toLowerCase();
      if (DANGEROUS_TAGS.has(tagName)) {
        el.remove();
        continue;
      }

      // Strip on* event handlers and dangerous protocol attributes
      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (
          name === "href" ||
          name.endsWith("href") ||
          name === "src" ||
          name === "action" ||
          name === "formaction" ||
          name === "srcdoc" ||
          name === "data"
        ) {
          if (isDangerousUrl(value, name === "src")) {
            el.removeAttribute(attr.name);
          }
        }
      }

      // Harden anchor links
      if (tagName === "a") {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }

    return doc.body.innerHTML;
  } catch (err) {
    console.warn("[CodeUI Sanitizer] Fallback due to parsing error:", err);
    return "";
  }
}
