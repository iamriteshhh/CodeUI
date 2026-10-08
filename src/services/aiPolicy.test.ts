import { describe, it, expect } from "vitest";
import policy from "../../src-tauri/ai-policy.json";
import { aiBlockReason, words } from "./aiPolicy";

// Mirrors the Rust tests in src-tauri/src/commands/extensions.rs (same ai-policy.json).
describe("AI extension policy", () => {
  it("is versioned for diagnostics", () => {
    expect(typeof policy.version).toBe("number");
  });

  it("blocks AI by id, wording and model names", () => {
    expect(aiBlockReason("github.copilot", "")).not.toBeNull();
    expect(aiBlockReason("anthropic.claude-code", "")).not.toBeNull();
    expect(aiBlockReason("foo.bar", "An AI-powered helper")).not.toBeNull();
    expect(aiBlockReason("foo.bar", "Uses GPT-4o for answers")).not.toBeNull();
    expect(aiBlockReason("foo.bar", "AI code completion for Rust")).not.toBeNull();
    expect(aiBlockReason("meta.pyrefly", "Python autocomplete, typechecking, code navigation and more! Powered by Pyrefly, an open-source language server")).toBeNull();
  });

  it("blocks known IDs in any case or padding", () => {
    for (const id of ["github.copilot", "GitHub.Copilot", " anthropic.claude-code ", "continue​.continue"]) {
      expect(aiBlockReason(id, ""), id).not.toBeNull();
    }
  });

  it("blocks AI keywords and phrases", () => {
    for (const text of [
      "AI",
      "Ask questions with a large language model",
      "Your AI pair programmer",
      "Powered by ChatGPT",
      "Local models through Ollama",
    ]) {
      expect(aiBlockReason("foo.bar", text), text).not.toBeNull();
    }
    expect(aiBlockReason("someone.tabnine-bridge", "")).not.toBeNull();
  });

  it("is not fooled by case, spacing, punctuation or invisible characters", () => {
    for (const text of [
      "Co-Pilot",
      "co pilot",
      "C​opilot",
      "c﻿o‍pilot",
      "CO_PILOT",
      "co.pilot",
      "c o p i l o t",
      "Ｃｏｐｉｌｏｔ", // fullwidth "Copilot"
      "Chat-GPT",
      "Open AI",
      "Clau_de",
      "A.I. helper",
      "gpt4o",
    ]) {
      expect(aiBlockReason("foo.bar", text), JSON.stringify(text)).not.toBeNull();
    }
  });

  it("allows ordinary extensions and matches whole words only", () => {
    expect(aiBlockReason("ziglang.vscode-zig", "Language support for the Zig programming language")).toBeNull();
    expect(aiBlockReason("dracula-theme.theme-dracula", "Official Dracula Theme. A dark theme for many editors")).toBeNull();
    expect(aiBlockReason("foo.bar", "Maintains a chain of trailing commas")).toBeNull();
    const safe: [string, string][] = [
      ["ms-python.python", "Python IntelliSense (Pylance), Debugging, linting"],
      ["esbenp.prettier-vscode", "Prettier - Code formatter using prettier"],
      ["rust-lang.rust-analyzer", "Rust Analyzer Rust language support for Visual Studio Code"],
      ["foo.chain", "Blockchain explorer: follow the chain of blocks"],
      ["foo.themes", "Free and paid colour themes"],
      ["foo.ddd", "Helps maintain domain models in large codebases"],
      ["foo.thai", "Thai language support and word breaking"],
      ["foo.tests", "Black box testing helpers"],
      ["foo.graphs", "Source graph visualizer for dependencies"],
      ["foo.xray", "Code X-ray: inspect C line endings"],
      ["foo.openapi", "OpenAPI and Swagger editor"],
    ];
    for (const [id, text] of safe) expect(aiBlockReason(id, text), `${id} ${text}`).toBeNull();
  });

  it("does not restrict Python for its Open VSX categories", () => {
    const listing =
      "python Python Python language support with extension access points for IntelliSense (Pylance), " +
      "Debugging (Python Debugger), linting, formatting, refactoring, unit tests, and more. ms-python " +
      "Programming Languages Debuggers Other Data Science Machine Learning";
    expect(aiBlockReason("ms-python.python", listing)).toBeNull();
  });

  it("splits words like the Rust side", () => {
    expect(words("C​opilot Co-Pilot __x__ Ｃｏ")).toEqual(["copilot", "co", "pilot", "x", "co"]);
  });
});
