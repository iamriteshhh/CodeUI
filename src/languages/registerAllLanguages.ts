import * as monaco from "../monaco";
import { registerSalivoLanguage } from "./salivoMonaco";

// Synchronous, eager imports of built-in Monaco Monarch definitions
// This guarantees instant, reliable syntax highlighting in both dev and packaged production WebViews
// without relying on lazy, dynamic network chunk loading.
// @ts-ignore
import * as cppLang from "monaco-editor/languages/definitions/cpp/cpp.js";
// @ts-ignore
import * as pythonLang from "monaco-editor/languages/definitions/python/python.js";
// @ts-ignore
import * as javaLang from "monaco-editor/languages/definitions/java/java.js";
// @ts-ignore
import * as rustLang from "monaco-editor/languages/definitions/rust/rust.js";
// @ts-ignore
import * as goLang from "monaco-editor/languages/definitions/go/go.js";
// @ts-ignore
import * as csharpLang from "monaco-editor/languages/definitions/csharp/csharp.js";
// @ts-ignore
import * as shellLang from "monaco-editor/languages/definitions/shell/shell.js";
// @ts-ignore
import * as powershellLang from "monaco-editor/languages/definitions/powershell/powershell.js";
// @ts-ignore
import * as markdownLang from "monaco-editor/languages/definitions/markdown/markdown.js";
// @ts-ignore
import * as htmlLang from "monaco-editor/languages/definitions/html/html.js";
// @ts-ignore
import * as cssLang from "monaco-editor/languages/definitions/css/css.js";
// @ts-ignore
import * as yamlLang from "monaco-editor/languages/definitions/yaml/yaml.js";
// @ts-ignore
import * as sqlLang from "monaco-editor/languages/definitions/sql/sql.js";
// @ts-ignore
import * as phpLang from "monaco-editor/languages/definitions/php/php.js";
// @ts-ignore
import * as rubyLang from "monaco-editor/languages/definitions/ruby/ruby.js";

// Native Monarch definition for Zig
const zigConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "//",
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string"] },
    { open: "'", close: "'", notIn: ["string", "comment"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

const zigMonarch: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".zig",
  keywords: [
    "const", "var", "fn", "pub", "export", "extern", "inline", "noinline",
    "return", "if", "else", "while", "for", "switch", "break", "continue",
    "defer", "errdefer", "try", "catch", "orelse", "resume", "suspend",
    "async", "await", "struct", "enum", "union", "error", "test",
    "comptime", "asm", "usingnamespace", "unreachable", "threadlocal",
  ],
  typeKeywords: [
    "i8", "i16", "i32", "i64", "i128", "isize",
    "u8", "u16", "u32", "u64", "u128", "usize",
    "f16", "f32", "f64", "f80", "f128",
    "bool", "void", "noreturn", "type", "anyerror", "anyopaque",
    "c_char", "c_short", "c_ushort", "c_int", "c_uint", "c_long",
    "c_ulong", "c_longlong", "c_ulonglong",
  ],
  constants: ["true", "false", "null", "undefined"],
  operators: [
    "=", ">", "<", "!", "~", "?", ":", "==", "<=", ">=", "!=",
    "&&", "||", "++", "--", "+", "-", "*", "/", "&", "|", "^",
    "%", "<<", ">>", "+=", "-=", "*=", "/=", "&=", "|=", "^=",
    "%=", "<<=", ">>=", "->", "=>",
  ],
  escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
  symbols: /[=><!~?:&|+\-*\/\^%]+/,
  tokenizer: {
    root: [
      [/@[a-zA-Z_]\w*/, "annotation"],
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@keywords": "keyword",
            "@typeKeywords": "type",
            "@constants": "constant",
            "@default": "identifier",
          },
        },
      ],
      { include: "@whitespace" },
      [/[{}()\[\]]/, "@brackets"],
      [/@symbols/, { cases: { "@operators": "operator", "@default": "" } }],
      [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
      [/0[xX][0-9a-fA-F]+/, "number.hex"],
      [/0[oO][0-7]+/, "number.octal"],
      [/0[bB][01]+/, "number.binary"],
      [/\d+/, "number"],
      [/[;,.]/, "delimiter"],
      [/"([^"\\]|\\.)*$/, "string.invalid"],
      [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
      [/'[^\\']'/, "string"],
      [/(')(@escapes)(')/, ["string", "string.escape", "string"]],
      [/'/, "string.invalid"],
    ],
    string: [
      [/[^\\"]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
    ],
    whitespace: [
      [/[ \t\r\n]+/, "white"],
      [/\/\/.*$/, "comment"],
    ],
  },
};

let hasRegistered = false;

export function registerAllEagerLanguages(monacoInstance: typeof monaco): {
  registered: string[];
  failed: Array<{ id: string; error: string }>;
} {
  const registered: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  if (hasRegistered) {
    return { registered, failed };
  }
  hasRegistered = true;

  try {
    // 1. Salivo language registration
    registerSalivoLanguage(monacoInstance);
    registered.push("salivo");
  } catch (err: unknown) {
    console.error("[registerAllEagerLanguages] Failed to register Salivo:", err);
    failed.push({ id: "salivo", error: String(err) });
  }

  // 2. Synchronous list of all core languages
  const definitions: Array<{
    id: string;
    conf?: monaco.languages.LanguageConfiguration;
    language?: monaco.languages.IMonarchLanguage;
    aliases?: string[];
    extensions?: string[];
  }> = [
    { id: "c", conf: cppLang.conf, language: cppLang.language, aliases: ["C", "c"], extensions: [".c", ".h"] },
    { id: "cpp", conf: cppLang.conf, language: cppLang.language, aliases: ["C++", "Cpp", "cpp"], extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"] },
    { id: "python", conf: pythonLang.conf, language: pythonLang.language, aliases: ["Python", "py"], extensions: [".py", ".pyw"] },
    { id: "java", conf: javaLang.conf, language: javaLang.language, aliases: ["Java", "java"], extensions: [".java", ".jav"] },
    { id: "rust", conf: rustLang.conf, language: rustLang.language, aliases: ["Rust", "rs"], extensions: [".rs"] },
    { id: "go", conf: goLang.conf, language: goLang.language, aliases: ["Go", "golang"], extensions: [".go"] },
    { id: "csharp", conf: csharpLang.conf, language: csharpLang.language, aliases: ["C#", "csharp"], extensions: [".cs"] },
    { id: "shell", conf: shellLang.conf, language: shellLang.language, aliases: ["Shell", "sh", "bash"], extensions: [".sh", ".bash"] },
    { id: "powershell", conf: powershellLang.conf, language: powershellLang.language, aliases: ["PowerShell", "ps1"], extensions: [".ps1", ".psm1"] },
    { id: "markdown", conf: markdownLang.conf, language: markdownLang.language, aliases: ["Markdown", "md"], extensions: [".md", ".markdown"] },
    { id: "html", conf: htmlLang.conf, language: htmlLang.language, aliases: ["HTML", "htm"], extensions: [".html", ".htm"] },
    { id: "css", conf: cssLang.conf, language: cssLang.language, aliases: ["CSS", "css"], extensions: [".css"] },
    { id: "yaml", conf: yamlLang.conf, language: yamlLang.language, aliases: ["YAML", "yaml", "yml"], extensions: [".yaml", ".yml"] },
    { id: "sql", conf: sqlLang.conf, language: sqlLang.language, aliases: ["SQL", "sql"], extensions: [".sql"] },
    { id: "php", conf: phpLang.conf, language: phpLang.language, aliases: ["PHP", "php"], extensions: [".php"] },
    { id: "ruby", conf: rubyLang.conf, language: rubyLang.language, aliases: ["Ruby", "rb"], extensions: [".rb"] },
    { id: "zig", conf: zigConfiguration, language: zigMonarch, aliases: ["Zig", "zig"], extensions: [".zig"] },
  ];

  try {
    const existingLangs = new Set(monacoInstance.languages.getLanguages().map((l) => l.id));

    for (const def of definitions) {
      try {
        if (!existingLangs.has(def.id)) {
          monacoInstance.languages.register({
            id: def.id,
            extensions: def.extensions,
            aliases: def.aliases,
          });
          existingLangs.add(def.id);
        }
        if (def.conf) {
          monacoInstance.languages.setLanguageConfiguration(def.id, def.conf);
        }
        if (def.language) {
          monacoInstance.languages.setMonarchTokensProvider(def.id, def.language);
        }
        registered.push(def.id);
      } catch (innerErr: unknown) {
        console.warn(`[registerAllEagerLanguages] Failed to register tokens for ${def.id}:`, innerErr);
        failed.push({ id: def.id, error: String(innerErr) });
      }
    }
  } catch (outerErr: unknown) {
    console.error("[registerAllEagerLanguages] Unexpected error registering languages:", outerErr);
  }

  return { registered, failed };
}
