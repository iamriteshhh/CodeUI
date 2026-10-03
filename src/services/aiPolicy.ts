import policy from "../../src-tauri/ai-policy.json";

// Same matching as ai_block_reason in src-tauri/src/commands/extensions.rs (the enforcing side).
// Lowercase words joined by single spaces, padded so includes(" term ") is a whole-word match.
export function normalize(text: string): string {
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return ` ${words.join(" ")} `;
}

export function aiBlockReason(id: string, text: string): string | null {
  const lowerId = id.toLowerCase();
  if (policy.blockedIds.includes(lowerId)) return `${id} is an AI extension`;
  const norm = normalize(`${id} ${text}`);
  const term = policy.terms.find((t) => norm.includes(normalize(t)));
  if (term) return `AI-related ("${term}")`;
  const words = norm.trim().split(" ");
  const prefix = policy.prefixes.find((p) => words.some((w) => w.startsWith(p)));
  if (prefix) return `AI-related ("${prefix}")`;
  return null;
}
