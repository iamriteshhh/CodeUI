// Monaco language definition and Monarch tokenizer for Salivo
// High-performance systems language with stream header imports (><)

export function registerSalivoLanguage(monaco: any) {
  if (!monaco || !monaco.languages) return;

  // 1. Register language ID
  const existingLanguages = monaco.languages.getLanguages();
  if (!existingLanguages.some((l: any) => l.id === "salivo")) {
    monaco.languages.register({
      id: "salivo",
      extensions: [".sal", ".sf", ".slv"],
      aliases: ["Salivo", "salivo"],
      mimetypes: ["text/x-salivo"],
    });
  }

  // 2. Language configuration (comments, brackets, auto-closing)
  monaco.languages.setLanguageConfiguration("salivo", {
    comments: {
      lineComment: "//",
      blockComment: ["/*", "*/"],
    },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
      ["<", ">"],
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
  });

  // 3. Monarch tokenizer
  monaco.languages.setMonarchTokensProvider("salivo", {
    defaultToken: "",
    tokenPostfix: ".sal",

    keywords: [
      "module",
      "pub",
      "func",
      "fn",
      "let",
      "const",
      "mut",
      "static",
      "use",
      "defer",
      "return",
      "for",
      "while",
      "loop",
      "if",
      "else",
      "match",
      "struct",
      "enum",
      "trait",
      "impl",
      "type",
      "true",
      "false",
      "drop",
      "Drop",
      "break",
      "continue",
      "in",
      "as",
      "async",
      "await",
    ],

    typeKeywords: [
      "int",
      "float",
      "bool",
      "string",
      "StrSlice",
      "ByteSlice",
      "byte",
      "char",
      "Option",
      "Result",
      "Vec",
      "Map",
      "Heap",
      "BTree",
      "Deq",
      "BtSet",
      "File",
      "Directory",
      "FileMetadata",
      "IoError",
      "void",
    ],

    builtins: [
      "outln",
      "out",
      "input",
      "in",
      "assert",
      "assertEq",
      "some",
      "none",
      "ok",
      "err",
      "vecNew",
      "mapNew",
      "heapNew",
      "btreeNew",
      "deqNew",
      "btSetNew",
      "open",
      "close",
      "pathJoin",
      "pathExists",
      "dirList",
      "sha256Hex",
      "secSeed",
      "now",
      "strint",
      "strfloat",
      "floatstr",
      "str",
      "min",
      "max",
      "abs",
    ],

    operators: [
      "><",
      "::",
      "->",
      "=>",
      "=",
      ">",
      "<",
      "!",
      "~",
      "?",
      ":",
      "==",
      "<=",
      ">=",
      "!=",
      "&&",
      "||",
      "++",
      "--",
      "+",
      "-",
      "*",
      "/",
      "&",
      "|",
      "^",
      "%",
    ],

    tokenizer: {
      root: [
        // Stream Header: >< followed by path
        [/^(\s*)(><)(\s*)([a-zA-Z0-9_.]+)/, ["white", "keyword.flow", "white", "string.target"]],
        [/><\s*/, "keyword.flow"],

        // Arrow and resolution
        [/->/, "operator.arrow"],
        [/::/, "delimiter"],

        // Identifiers and keywords
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              "@keywords": "keyword",
              "@typeKeywords": "type",
              "@builtins": "predefined",
              "@default": "identifier",
            },
          },
        ],

        // Whitespace & comments
        { include: "@whitespace" },

        // Delimiters and operators
        [/[{}()\[\]]/, "@brackets"],
        [/[;,]/, "delimiter"],
        [
          /[=><!~?:&|+\-*\/\^%]+/,
          {
            cases: {
              "@operators": "operator",
              "@default": "",
            },
          },
        ],

        // Numbers
        [/\d*\.\d+([eE][\-+]?\d+)?/, "number.float"],
        [/0[xX][0-9a-fA-F]+/, "number.hex"],
        [/\d+/, "number"],

        // Strings
        [/\$"/, { token: "string.interpolated", next: "@interpolatedString" }],
        [/"([^"\\]|\\.)*$/, "string.invalid"],
        [/"/, { token: "string.quote", bracket: "@open", next: "@string" }],
        [/'[^\\']'/, "string"],
      ],

      whitespace: [
        [/[ \t\r\n]+/, "white"],
        [/\/\*/, "comment", "@comment"],
        [/\/\/.*$/, "comment"],
      ],

      comment: [
        [/[^\/*]+/, "comment"],
        [/\/\*/, "comment", "@push"],
        ["\\*/", "comment", "@pop"],
        [/[\/*]/, "comment"],
      ],

      string: [
        [/[^\\"]+/, "string"],
        [/\\./, "string.escape"],
        [/"/, { token: "string.quote", bracket: "@close", next: "@pop" }],
      ],

      interpolatedString: [
        [/[^\\"{]+/, "string.interpolated"],
        [/\{/, { token: "delimiter.bracket", next: "@interpolatedExpr" }],
        [/\\./, "string.escape"],
        [/"/, { token: "string.interpolated", next: "@pop" }],
      ],

      interpolatedExpr: [
        [/\}/, { token: "delimiter.bracket", next: "@pop" }],
        { include: "@root" },
      ],
    },
  });
}
