// Lean Monaco entry. The full "monaco-editor" entry eagerly bundles the TypeScript/CSS/HTML
// language services, an LSP client, every language grammar and the suggest / hover /
// inline-completion UI. CodeUI is a no-suggestions lab editor, so it loads the core editor,
// the plain editing features, lazily-loaded Monarch grammars and JSON tokenization only.
import "monaco-esm/editor/browser/coreCommands.js";
import "monaco-esm/editor/browser/widget/codeEditor/codeEditorWidget.js";
import "monaco-esm/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-esm/base/browser/ui/codicons/codicon/codicon-modifiers.css";
import "monaco-esm/editor/common/standaloneStrings.js";
import "monaco-esm/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-esm/editor/contrib/caretOperations/browser/caretOperations.js";
import "monaco-esm/editor/contrib/caretOperations/browser/transpose.js";
import "monaco-esm/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-esm/editor/contrib/comment/browser/comment.js";
import "monaco-esm/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-esm/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-esm/features/find/register.js";
import "monaco-esm/editor/contrib/find/browser/findController.js";
import "monaco-esm/editor/contrib/indentation/browser/indentation.js";
import "monaco-esm/editor/contrib/lineSelection/browser/lineSelection.js";
import "monaco-esm/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-esm/editor/contrib/longLinesHelper/browser/longLinesHelper.js";
import "monaco-esm/editor/contrib/middleScroll/browser/middleScroll.contribution.js";
import "monaco-esm/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-esm/editor/contrib/readOnlyMessage/browser/contribution.js";
import "monaco-esm/editor/contrib/smartSelect/browser/smartSelect.js";
import "monaco-esm/editor/contrib/tokenization/browser/tokenization.js";
import "monaco-esm/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js";
import "monaco-esm/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter.js";
import "monaco-esm/editor/contrib/unusualLineTerminators/browser/unusualLineTerminators.js";
import "monaco-esm/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-esm/editor/contrib/wordPartOperations/browser/wordPartOperations.js";
import "monaco-esm/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-esm/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "monaco-esm/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js";
// Every Monarch grammar, each loaded on first use of its language.
import "monaco-esm/languages/definitions/register.all.js";
// JSON has no Monarch grammar; its mode tokenizes on the main thread. Every language-service
// feature is switched off in applyZeroSuggestionsLockdown, so its worker never starts.
import { jsonDefaults } from "monaco-esm/languages/features/json/register.js";

export * from "monaco-editor/editor/editor.api";
export const json = { jsonDefaults };
