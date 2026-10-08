import policy from "../../src-tauri/ai-policy.json";

// UI labels for the multi-signal policy for known and identifiable AI-assistance extensions.
// Same data (ai-policy.json) and same matching as ai_block_reason in
// src-tauri/src/commands/extensions.rs, which is the enforcing side.

const INVISIBLE = /[​-‍⁠﻿­]/g;
const FULLWIDTH = /[！-～]/g;
// Longest joined run of words worth building; longer than any policy term.
const MAX_RUN = 40;

/** Lowercase alphanumeric words; must stay identical to `words` in extensions.rs. */
export function words(text: string): string[] {
  return text
    .replace(INVISIBLE, "")
    .replace(FULLWIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .split(/[^\p{Alphabetic}\p{N}]+/u)
    .filter(Boolean);
}

/** Every run of consecutive words joined without separators ("co pilot" -> "copilot"). */
function wordRuns(w: string[]): Set<string> {
  const runs = new Set<string>();
  for (let i = 0; i < w.length; i++) {
    let run = "";
    for (const word of w.slice(i)) {
      run += word;
      runs.add(run);
      if (run.length >= MAX_RUN) break;
    }
  }
  return runs;
}

export function aiBlockReason(id: string, text: string): string | null {
  const cleanId = id.replace(INVISIBLE, "").trim().toLowerCase();
  if (policy.blockedIds.includes(cleanId)) return `${id} is an AI extension`;
  const w = words(`${id} ${text}`);
  const spaced = ` ${w.join(" ")} `;
  const term = policy.terms.find((t) => spaced.includes(` ${words(t).join(" ")} `));
  if (term) return `AI-related ("${term}")`;
  const runs = wordRuns(w);
  const compact = policy.compactTerms.find((t) => runs.has(words(t).join("")));
  if (compact) return `AI-related ("${compact}")`;
  const prefix = policy.prefixes.find((p) => [...runs].some((r) => r.startsWith(p)));
  if (prefix) return `AI-related ("${prefix}")`;
  return null;
}
