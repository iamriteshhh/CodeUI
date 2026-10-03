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

  hover: { enabled: "off" },
  codeLens: false,
  formatOnType: false,
  formatOnPaste: false,
  autoClosingBrackets: "never",
  autoClosingQuotes: "never",
  autoClosingDelete: "never",
  autoClosingOvertype: "never",
  autoSurround: "never",
  linkedEditing: false,
  renameOnType: false,
  definitionLinkOpensInPeek: false,
  inlayHints: { enabled: "off" },

  // Visual ergonomics & stability
  fontSize: 14,
  lineHeight: 21,
  fontFamily: '"CodeUI Mono", Consolas, "Courier New", monospace',
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
  disableLayerHinting: false,
  renderLineHighlight: "line",
  occurrencesHighlight: "off",
  selectionHighlight: true,
  matchBrackets: "always",
  contextmenu: true,
};

/**
 * Strict lab-safe lockdown (Y1): Neutralizes all language-service providers
 * (completions, hovers, code actions/lightbulbs, definitions, renames) across all languages,
 * ensuring students write code purely from knowledge. Monarch syntax highlighting remains active.
 */
export function applyZeroSuggestionsLockdown(monacoInstance: any) {
  if (!monacoInstance || !monacoInstance.languages) return;

  const dummyDisposable = { dispose: () => {} };

  // Intercept and neutralize provider registration
  monacoInstance.languages.registerCompletionItemProvider = () => dummyDisposable;
  monacoInstance.languages.registerHoverProvider = () => dummyDisposable;
  monacoInstance.languages.registerCodeActionProvider = () => dummyDisposable;
  monacoInstance.languages.registerDefinitionProvider = () => dummyDisposable;
  monacoInstance.languages.registerReferenceProvider = () => dummyDisposable;
  monacoInstance.languages.registerRenameProvider = () => dummyDisposable;
  monacoInstance.languages.registerSignatureHelpProvider = () => dummyDisposable;
  monacoInstance.languages.registerInlayHintsProvider = () => dummyDisposable;
  monacoInstance.languages.registerCodeLensProvider = () => dummyDisposable;
  monacoInstance.languages.registerInlineCompletionsProvider = () => dummyDisposable;
  monacoInstance.languages.registerNewSymbolNameProvider = () => dummyDisposable;

  // Strict mode configuration for built-in worker languages
  const noAssistance = {
    completionItems: false,
    hovers: false,
    documentHighlights: false,
    definitions: false,
    referenceProviders: false,
    documentSymbols: false,
    signatureHelp: false,
    rename: false,
    colors: false,
    folding: false,
    selectionRanges: false,
    documentFormattingEdits: false,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
    codeActions: false,
    inlayHints: false,
    diagnostics: false,
  };

  // Monaco >= 0.55 exposes these at the top level (monaco.typescript); older builds under monaco.languages.
  const ns = (name: string) => monacoInstance[name] ?? monacoInstance.languages[name];
  const defaults = [
    ns("typescript")?.typescriptDefaults,
    ns("typescript")?.javascriptDefaults,
    ns("css")?.cssDefaults,
    ns("css")?.scssDefaults,
    ns("css")?.lessDefaults,
    ns("html")?.htmlDefaults,
    ns("html")?.handlebarDefaults,
    ns("html")?.razorDefaults,
    ns("json")?.jsonDefaults,
  ];
  for (const d of defaults) {
    try {
      d?.setModeConfiguration(noAssistance);
    } catch (err) {
      console.warn("Failed to apply mode configuration lockdown:", err);
    }
  }
}

/**
 * Binds no-op handlers to all manual completion/hint shortcuts on the editor instance (Y1).
 */
export function blockManualSuggestionShortcuts(editor: any, monacoInstance: any) {
  if (!editor || !monacoInstance) return;

  const blocked = [
    monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Space,
    monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.Space,
    monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.Enter,
    monacoInstance.KeyCode.F12,
    monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.F12,
    monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.F12,
    monacoInstance.KeyCode.F2,
  ];

  for (const shortcut of blocked) {
    editor.addCommand(shortcut, () => {
      // Zero suggestions tenet: strictly no-op
    });
  }
}
