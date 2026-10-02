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
]);

/**
 * Sanitizes an HTML string to prevent XSS attacks in the Tauri webview.
 */
export function sanitizeHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== "string") return "";
  if (typeof DOMParser === "undefined") {
    // In headless Node test environments without DOMParser, strip dangerous tags via regex
    return rawHtml
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
      .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
      .replace(/<embed\b[^>]*>/gi, "")
      .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bon\w+\s*=\s*[^>\s]+/gi, "")
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
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
        const value = attr.value.trim().toLowerCase();

        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
          continue;
        }

        if (name === "href" || name === "src" || name === "action") {
          if (
            value.startsWith("javascript:") ||
            value.startsWith("vbscript:") ||
            (value.startsWith("data:") && !value.startsWith("data:image/"))
          ) {
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
