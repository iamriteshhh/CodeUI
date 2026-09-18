import type { EditorProps } from "@monaco-editor/react";

/**
 * Hard Project Constraint from TASK_DIVISION.md & README.md:
 * NO AUTOCOMPLETE, SUGGESTIONS, OR AI IN THE EDITOR — EVER.
 *
 * College laboratory practical mode requirement: Students must write code
 * by memory and syntax understanding without editor suggestions or code completion.
 */
export const MONACO_LAB_SAFE_OPTIONS: NonNullable<EditorProps["options"]> = {
  // Suggestion engines completely disabled
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: "off",
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
  lightbulb: { enabled: false as unknown as undefined },
  suggest: {
    showWords: false,
    showSnippets: false,
    showClasses: false,
    showFunctions: false,
    showVariables: false,
    showConstants: false,
    showKeywords: false,
    showMethods: false,
    showProperties: false,
    showEvents: false,
    showOperators: false,
    showUnits: false,
    showValues: false,
    showColors: false,
    showFiles: false,
    showReferences: false,
    showFolders: false,
    showTypeParameters: false,
    showIssues: false,
    showUsers: false,
    showStructs: false,
    showInterfaces: false,
    showModules: false,
  },
  acceptSuggestionOnCommitCharacter: false,
  acceptSuggestionOnEnter: "off",
  tabCompletion: "off",
  snippetSuggestions: "none",

  // Visual ergonomics & performance
  fontSize: 14,
  lineNumbers: "on",
  glyphMargin: false,
  folding: true,
  lineDecorationsWidth: 10,
  lineNumbersMinChars: 3,
  minimap: { enabled: true, side: "right", scale: 1 },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderWhitespace: "selection",
  cursorBlinking: "smooth",
  smoothScrolling: true,
  contextmenu: true,
};
