import { describe, it, expect } from "vitest";
import { rebase, isInside, validateName, dirname, basename } from "./path";
import { parseCompilerDiagnostics } from "../services/diagnostics";

describe("Store & Filesystem Command Logic", () => {
  it("rebases open tabs cleanly during folder rename while preserving paths", () => {
    const oldFolder = "D:\\projects\\myapp";
    const newFolder = "D:\\projects\\newapp";
    const openTabPath = "D:\\projects\\myapp\\src\\components\\Button.tsx";

    expect(isInside(openTabPath, oldFolder)).toBe(true);
    const rebased = rebase(openTabPath, oldFolder, newFolder);
    expect(rebased).toBe("D:\\projects\\newapp\\src\\components\\Button.tsx");
    expect(basename(rebased)).toBe("Button.tsx");
    expect(dirname(rebased)).toBe("D:\\projects\\newapp\\src\\components");
  });

  it("identifies all descendant tabs when deleting a parent directory", () => {
    const deletedDir = "/home/user/workspace/src";
    const childFile1 = "/home/user/workspace/src/index.ts";
    const childFile2 = "/home/user/workspace/src/utils/helpers.ts";
    const siblingFile = "/home/user/workspace/package.json";

    expect(isInside(childFile1, deletedDir)).toBe(true);
    expect(isInside(childFile2, deletedDir)).toBe(true);
    expect(isInside(siblingFile, deletedDir)).toBe(false);
  });

  it("validates names strictly preventing traversal and invalid chars", () => {
    expect(validateName("../escape")).not.toBeNull();
    expect(validateName("folder/sub")).not.toBeNull();
    expect(validateName("file:name")).not.toBeNull();
    expect(validateName("CON")).not.toBeNull();
    expect(validateName("valid_file.rs")).toBeNull();
    expect(validateName("MyComponent.tsx")).toBeNull();
  });

  it("connects compiler diagnostics to source lines", () => {
    const gccOutput = "main.c:15:5: error: expected ';' before 'return'";
    const diags = parseCompilerDiagnostics("c", gccOutput, "main.c");
    expect(diags).toHaveLength(1);
    expect(diags[0].line).toBe(15);
    expect(diags[0].column).toBe(5);
    expect(diags[0].severity).toBe("error");
    expect(diags[0].message).toContain("expected ';'");
  });
});
