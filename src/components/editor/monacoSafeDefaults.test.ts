import { describe, it, expect, vi } from "vitest";
import {
  MONACO_LAB_SAFE_OPTIONS,
  applyZeroSuggestionsLockdown,
  blockManualSuggestionShortcuts,
} from "./monacoSafeDefaults";

describe("Zero Suggestions & Lab-Safe Lockdown (Y1)", () => {
  it("enforces complete disabling of all automatic suggestion engines in options", () => {
    expect(MONACO_LAB_SAFE_OPTIONS.quickSuggestions).toBe(false);
    expect(MONACO_LAB_SAFE_OPTIONS.suggestOnTriggerCharacters).toBe(false);
    expect(MONACO_LAB_SAFE_OPTIONS.wordBasedSuggestions).toBe("off");
    expect(MONACO_LAB_SAFE_OPTIONS.tabCompletion).toBe("off");
    expect(MONACO_LAB_SAFE_OPTIONS.snippetSuggestions).toBe("none");
    expect(MONACO_LAB_SAFE_OPTIONS.formatOnType).toBe(false);
    expect(MONACO_LAB_SAFE_OPTIONS.formatOnPaste).toBe(false);
    expect(MONACO_LAB_SAFE_OPTIONS.codeLens).toBe(false);

    // Deep check on suggest object
    const suggest = MONACO_LAB_SAFE_OPTIONS.suggest as Record<string, boolean>;
    expect(suggest.showWords).toBe(false);
    expect(suggest.showKeywords).toBe(false);
    expect(suggest.showSnippets).toBe(false);
    expect(suggest.showClasses).toBe(false);
    expect(suggest.showFunctions).toBe(false);
    expect(suggest.showVariables).toBe(false);

    // Deep check on parameterHints, inlineSuggest, hover, inlayHints
    expect((MONACO_LAB_SAFE_OPTIONS.parameterHints as any)?.enabled).toBe(false);
    expect((MONACO_LAB_SAFE_OPTIONS.inlineSuggest as any)?.enabled).toBe(false);
    expect((MONACO_LAB_SAFE_OPTIONS.hover as any)?.enabled).toBe("off");
    expect((MONACO_LAB_SAFE_OPTIONS.inlayHints as any)?.enabled).toBe("off");
  });

  it("neutralizes language provider registration at the API boundary", () => {
    const mockLanguages: any = {
      registerCompletionItemProvider: vi.fn(),
      registerHoverProvider: vi.fn(),
      registerCodeActionProvider: vi.fn(),
      registerDefinitionProvider: vi.fn(),
      registerReferenceProvider: vi.fn(),
      registerRenameProvider: vi.fn(),
      registerSignatureHelpProvider: vi.fn(),
      registerInlayHintsProvider: vi.fn(),
      registerCodeLensProvider: vi.fn(),
      typescript: {
        typescriptDefaults: { setModeConfiguration: vi.fn() },
        javascriptDefaults: { setModeConfiguration: vi.fn() },
      },
      css: { cssDefaults: { setModeConfiguration: vi.fn() } },
      html: { htmlDefaults: { setModeConfiguration: vi.fn() } },
      json: { jsonDefaults: { setModeConfiguration: vi.fn() } },
    };

    const mockMonaco: any = { languages: mockLanguages };

    applyZeroSuggestionsLockdown(mockMonaco);

    // Calling neutralized registerCompletionItemProvider must return a disposable and NOT call original
    const result = mockMonaco.languages.registerCompletionItemProvider("javascript", {
      provideCompletionItems: () => ({ suggestions: [{ label: "secret" }] }),
    });

    expect(result).toBeDefined();
    expect(typeof result.dispose).toBe("function");

    // Mode configurations must disable completionItems, hovers, definitions, codeActions, diagnostics
    const tsCall = mockLanguages.typescript.typescriptDefaults.setModeConfiguration.mock.calls[0][0];
    expect(tsCall.completionItems).toBe(false);
    expect(tsCall.hovers).toBe(false);
    expect(tsCall.definitions).toBe(false);
    expect(tsCall.codeActions).toBe(false);
  });

  it("blocks manual trigger keyboard shortcuts on the editor instance", () => {
    const commands: Array<{ keybinding: number; handler: () => void }> = [];
    const mockEditor = {
      addCommand: vi.fn((keybinding, handler) => {
        commands.push({ keybinding, handler });
      }),
    };

    const mockMonaco = {
      KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
      KeyCode: { Space: 9, Enter: 3, F12: 105, F2: 95 },
    };

    blockManualSuggestionShortcuts(mockEditor, mockMonaco);

    // Verify 7 critical manual trigger shortcuts are intercepted
    expect(mockEditor.addCommand).toHaveBeenCalledTimes(7);

    // Execute each handler to ensure they strictly execute as no-ops without throwing
    for (const cmd of commands) {
      expect(() => cmd.handler()).not.toThrow();
    }
  });
});

describe("Lockdown on Monaco >= 0.55 layout", () => {
  it("blocks inline (ghost-text) completions and reaches top-level language-service namespaces", () => {
    const real = vi.fn();
    const topTs = {
      typescriptDefaults: { setModeConfiguration: vi.fn() },
      javascriptDefaults: { setModeConfiguration: vi.fn() },
    };
    const topHtml = { htmlDefaults: { setModeConfiguration: vi.fn() } };
    const mockMonaco: any = {
      typescript: topTs,
      html: topHtml,
      languages: { registerInlineCompletionsProvider: real },
    };

    applyZeroSuggestionsLockdown(mockMonaco);

    const result = mockMonaco.languages.registerInlineCompletionsProvider("c", {});
    expect(typeof result.dispose).toBe("function");
    expect(real).not.toHaveBeenCalled();
    for (const d of [topTs.typescriptDefaults, topTs.javascriptDefaults, topHtml.htmlDefaults]) {
      expect(d.setModeConfiguration).toHaveBeenCalledWith(expect.objectContaining({ completionItems: false }));
    }
  });
});
