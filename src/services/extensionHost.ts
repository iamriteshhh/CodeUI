// Loads the declarative parts of installed extensions into Monaco: TextMate grammars,
// language configuration and colour themes. Extension code is never run; snippets are
// never loaded (lab rule: no suggestions).
import * as monaco from "../monaco";
import { Registry, INITIAL, parseRawGrammar, type StateStack, type IGrammar } from "vscode-textmate";
import { loadWASM, OnigScanner, OnigString } from "vscode-oniguruma";
import onigWasmUrl from "vscode-oniguruma/release/onig.wasm?url";
import { ExtLanguage, ExtTheme, InstalledExtension } from "../types";
import { readExtensionFile } from "./extensionService";
import { setExtensionLanguage } from "../languages/extLanguageMap";

const DEFAULT_THEME = "codeui-dark";
const THEME_KEY = "codeui.colorTheme";

// --- JSONC (VS Code config files allow comments and trailing commas) ---

export function parseJsonc(text: string): any {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

// --- TextMate engine ---

const grammarSources = new Map<string, { extId: string; path: string }>();
const injections = new Map<string, string[]>();
let onig: Promise<void> | null = null;

const registry = new Registry({
  onigLib: (onig ??= fetch(onigWasmUrl)
    .then((r) => r.arrayBuffer())
    .then((buf) => loadWASM(buf))).then(() => ({
    createOnigScanner: (patterns: string[]) => new OnigScanner(patterns),
    createOnigString: (s: string) => new OnigString(s),
  })),
  loadGrammar: async (scopeName) => {
    const src = grammarSources.get(scopeName);
    if (!src) return null;
    return parseRawGrammar(await readExtensionFile(src.extId, src.path), src.path);
  },
  getInjections: (scopeName) => injections.get(scopeName),
});

class TmState implements monaco.languages.IState {
  constructor(readonly stack: StateStack) {}
  clone() {
    return new TmState(this.stack.clone());
  }
  equals(other: monaco.languages.IState) {
    return other instanceof TmState && other.stack.equals(this.stack);
  }
}

// Scopes that carry no colour of their own; the enclosing scope decides (VS Code behaves the same).
const NEUTRAL = new Set(["punctuation", "meta", "source", "text"]);

export function pickScope(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (!NEUTRAL.has(scopes[i].split(".")[0])) return scopes[i];
  }
  return scopes[scopes.length - 1] ?? "";
}

function attachGrammar(languageId: string, grammar: IGrammar) {
  monaco.languages.setTokensProvider(languageId, {
    getInitialState: () => new TmState(INITIAL),
    tokenize(line, state) {
      const r = grammar.tokenizeLine(line, (state as TmState).stack, 500);
      return {
        endState: new TmState(r.ruleStack),
        tokens: r.tokens.map((t) => ({ startIndex: t.startIndex, scopes: pickScope(t.scopes) })),
      };
    },
  });
}

// --- language configuration ---

function toRegExp(v: any): RegExp | undefined {
  try {
    if (typeof v === "string") return new RegExp(v);
    if (v && typeof v.pattern === "string") return new RegExp(v.pattern, v.flags);
  } catch {
    // Oniguruma-only syntax; Monaco falls back to its default
  }
  return undefined;
}

function toPairs(list: any): monaco.languages.IAutoClosingPairConditional[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((p) => (Array.isArray(p) ? { open: p[0], close: p[1] } : { open: p.open, close: p.close, notIn: p.notIn }));
}

export function toLanguageConfiguration(c: any): monaco.languages.LanguageConfiguration {
  return {
    comments: c.comments,
    brackets: c.brackets,
    autoClosingPairs: toPairs(c.autoClosingPairs),
    surroundingPairs: toPairs(c.surroundingPairs),
    wordPattern: toRegExp(c.wordPattern),
    indentationRules: c.indentationRules && {
      increaseIndentPattern: toRegExp(c.indentationRules.increaseIndentPattern) ?? /^$/,
      decreaseIndentPattern: toRegExp(c.indentationRules.decreaseIndentPattern) ?? /^$/,
    },
    folding: c.folding && {
      offSide: c.folding.offSide,
      markers:
        c.folding.markers && toRegExp(c.folding.markers.start) && toRegExp(c.folding.markers.end)
          ? { start: toRegExp(c.folding.markers.start)!, end: toRegExp(c.folding.markers.end)! }
          : undefined,
    },
  };
}

// --- activation ---

const activated = new Set<string>();

function registerLanguage(lang: ExtLanguage) {
  if (!monaco.languages.getLanguages().some((l) => l.id === lang.id)) {
    monaco.languages.register({ id: lang.id, aliases: lang.aliases, extensions: lang.extensions, filenames: lang.filenames });
  }
  for (const e of lang.extensions ?? []) setExtensionLanguage(e, lang.id);
  for (const f of lang.filenames ?? []) setExtensionLanguage(f, lang.id);
}

/** Loads one installed extension. Failures stay local to that extension. */
export async function activateExtension(ext: InstalledExtension): Promise<void> {
  if (!ext.enabled || activated.has(ext.id)) return;
  activated.add(ext.id);
  const { languages, grammars } = ext.contributes;

  for (const lang of languages ?? []) {
    if (!lang?.id) continue;
    registerLanguage(lang);
    if (lang.configuration) {
      try {
        const cfg = parseJsonc(await readExtensionFile(ext.id, lang.configuration));
        monaco.languages.setLanguageConfiguration(lang.id, toLanguageConfiguration(cfg));
      } catch (e) {
        console.warn(`[${ext.id}] language configuration for ${lang.id} not loaded:`, e);
      }
    }
  }

  for (const g of grammars ?? []) {
    if (!g?.scopeName || !g.path) continue;
    grammarSources.set(g.scopeName, { extId: ext.id, path: g.path });
    for (const target of g.injectTo ?? []) {
      injections.set(target, [...(injections.get(target) ?? []), g.scopeName]);
    }
  }
  for (const g of grammars ?? []) {
    if (!g?.language || !g.scopeName) continue;
    try {
      const grammar = await registry.loadGrammar(g.scopeName);
      if (grammar) attachGrammar(g.language, grammar);
    } catch (e) {
      console.warn(`[${ext.id}] grammar ${g.scopeName} not loaded:`, e);
    }
  }
}

export async function activateExtensions(list: InstalledExtension[]): Promise<void> {
  await Promise.all(list.map((e) => activateExtension(e)));
  await restoreColorTheme(list);
}

// --- colour themes ---

let currentTheme = DEFAULT_THEME;
export const getEditorTheme = () => currentTheme;

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function hex6(color: unknown): string | undefined {
  if (typeof color !== "string" || !HEX.test(color)) return undefined;
  let h = color.slice(1);
  if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  return h.slice(0, 6);
}

async function readTheme(extId: string, path: string, depth = 0): Promise<{ colors: Record<string, string>; tokenColors: any[] }> {
  const json = parseJsonc(await readExtensionFile(extId, path));
  let base = { colors: {} as Record<string, string>, tokenColors: [] as any[] };
  if (typeof json.include === "string" && depth < 5) {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    base = await readTheme(extId, dir + json.include.replace(/^\.\//, ""), depth + 1);
  }
  return {
    colors: { ...base.colors, ...(json.colors ?? {}) },
    tokenColors: [...base.tokenColors, ...(Array.isArray(json.tokenColors) ? json.tokenColors : [])],
  };
}

export function themeId(extId: string, theme: ExtTheme) {
  return `ext-${extId}-${theme.id ?? theme.label}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

async function defineExtensionTheme(extId: string, theme: ExtTheme): Promise<string> {
  const { colors, tokenColors } = await readTheme(extId, theme.path);
  const rules: monaco.editor.ITokenThemeRule[] = [];
  for (const tc of tokenColors) {
    const s = tc?.settings ?? {};
    const scopes: string[] = !tc?.scope ? [""] : Array.isArray(tc.scope) ? tc.scope : String(tc.scope).split(",");
    for (const raw of scopes) {
      // Monaco matches by dotted prefix only; use the last part of descendant selectors.
      const token = raw.trim().split(/\s+/).pop() ?? "";
      rules.push({ token, foreground: hex6(s.foreground), fontStyle: s.fontStyle });
    }
  }
  const validColors = Object.fromEntries(Object.entries(colors).filter(([, v]) => typeof v === "string" && HEX.test(v)));
  const id = themeId(extId, theme);
  monaco.editor.defineTheme(id, {
    base: theme.uiTheme === "vs" ? "vs" : theme.uiTheme === "hc-black" ? "hc-black" : "vs-dark",
    inherit: true,
    rules,
    colors: validColors,
  });
  return id;
}

/** Switches the editor colour theme; `null` returns to CodeUI's default. */
export async function applyColorTheme(extId: string | null, theme: ExtTheme | null): Promise<void> {
  currentTheme = extId && theme ? await defineExtensionTheme(extId, theme) : DEFAULT_THEME;
  monaco.editor.setTheme(currentTheme);
  try {
    if (extId && theme) localStorage.setItem(THEME_KEY, JSON.stringify({ extId, path: theme.path }));
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}

async function restoreColorTheme(list: InstalledExtension[]): Promise<void> {
  let saved: { extId: string; path: string } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(THEME_KEY) ?? "null");
  } catch {
    return;
  }
  if (!saved) return;
  const ext = list.find((e) => e.id === saved!.extId && e.enabled);
  const theme = ext?.contributes.themes?.find((t) => t.path === saved!.path);
  try {
    await applyColorTheme(ext && theme ? ext.id : null, theme ?? null);
  } catch (e) {
    console.warn("Saved colour theme not loaded:", e);
    await applyColorTheme(null, null);
  }
}
