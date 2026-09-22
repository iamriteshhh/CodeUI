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

  // Visual ergonomics & stability
  fontSize: 14,
  lineHeight: 20,
  fontFamily: "Consolas, 'Courier New', monospace",
  lineNumbers: "on",
  glyphMargin: false,
  folding: false,
  showFoldingControls: "never",
  dragAndDrop: false, // Disables accidental drag & drop of text chunks when clicking rapidly
  mouseWheelZoom: false, // Prevents viewport scaling desynchronizing line offsets
  links: false,
  selectOnLineNumbers: true,
  multiCursorModifier: "alt",
  lineDecorationsWidth: 10,
  lineNumbersMinChars: 3,
  minimap: { enabled: true, side: "right", scale: 1 },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  renderWhitespace: "none",
  cursorBlinking: "solid",
  cursorSmoothCaretAnimation: "off",
  smoothScrolling: false,
  disableLayerHinting: false, // Keep GPU hardware acceleration enabled to prevent line repaint collisions
  renderLineHighlight: "none", // Eliminates active line overlay that was shifting vertical coordinates on click
  occurrencesHighlight: "off", // Disables background highlighting on matching words across lines on click
  selectionHighlight: false, // Disables selection-based word highlights across lines
  matchBrackets: "never", // Disables bracket matching decoration shifts
  contextmenu: true,
};
