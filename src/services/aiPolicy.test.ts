import { describe, it, expect } from "vitest";
import { aiBlockReason } from "./aiPolicy";

describe("AI extension policy", () => {
  it("blocks AI by id, wording and model names", () => {
    expect(aiBlockReason("github.copilot", "")).not.toBeNull();
    expect(aiBlockReason("anthropic.claude-code", "")).not.toBeNull();
    expect(aiBlockReason("foo.bar", "An AI-powered helper")).not.toBeNull();
    expect(aiBlockReason("foo.bar", "Uses GPT-4o for answers")).not.toBeNull();
    expect(aiBlockReason("foo.bar", "AI code completion for Rust")).not.toBeNull();
    expect(aiBlockReason("meta.pyrefly", "Python autocomplete, typechecking, code navigation and more! Powered by Pyrefly, an open-source language server")).toBeNull();
  });

  it("allows ordinary extensions and matches whole words only", () => {
    expect(aiBlockReason("ziglang.vscode-zig", "Language support for the Zig programming language")).toBeNull();
    expect(aiBlockReason("dracula-theme.theme-dracula", "Official Dracula Theme. A dark theme for many editors")).toBeNull();
    expect(aiBlockReason("foo.bar", "Maintains a chain of trailing commas")).toBeNull();
  });

  it("does not restrict Python for its Open VSX categories", () => {
    const listing =
      "python Python Python language support with extension access points for IntelliSense (Pylance), " +
      "Debugging (Python Debugger), linting, formatting, refactoring, unit tests, and more. ms-python " +
      "Programming Languages Debuggers Other Data Science Machine Learning";
    expect(aiBlockReason("ms-python.python", listing)).toBeNull();
  });
});
