import { describe, it, expect } from "vitest";
import { parseCompilerDiagnostics } from "./diagnostics";

describe("parseCompilerDiagnostics", () => {
  describe("gcc / g++ / clang diagnostics", () => {
    it("parses gcc error with line and column on Unix", () => {
      const output = `/home/user/project/main.c:12:5: error: expected ';' before 'return'
   12 |     return 0;
      |     ^~~~~~`;

      const diags = parseCompilerDiagnostics("c", output, "/home/user/project/main.c");
      expect(diags).toHaveLength(1);
      expect(diags[0]).toEqual({
        file: "/home/user/project/main.c",
        line: 12,
        column: 5,
        endColumn: 10,
        severity: "error",
        message: "expected ';' before 'return'",
      });
    });

    it("parses gcc error with Windows drive letter path", () => {
      const output = `C:\\Users\\student\\project\\test.c:8:14: warning: unused variable 'x' [-Wunused-variable]
    8 |     int x = 10;
      |              ^`;

      const diags = parseCompilerDiagnostics("c", output, "C:\\Users\\student\\project\\test.c");
      expect(diags).toHaveLength(1);
      expect(diags[0]).toEqual({
        file: "C:\\Users\\student\\project\\test.c",
        line: 8,
        column: 14,
        endColumn: 19,
        severity: "warning",
        message: "unused variable 'x' [-Wunused-variable]",
      });
    });
  });

  describe("javac diagnostics", () => {
    it("parses javac compile error and column caret", () => {
      const output = `Main.java:5: error: cannot find symbol
        System.out.println(undefinedVar);
                           ^
  symbol:   variable undefinedVar
  location: class Main
1 error`;

      const diags = parseCompilerDiagnostics("java", output, "C:\\work\\Main.java");
      expect(diags).toHaveLength(1);
      expect(diags[0].line).toBe(5);
      expect(diags[0].column).toBe(28);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toBe("cannot find symbol");
    });
  });

  describe("python diagnostics", () => {
    it("parses python syntax error traceback", () => {
      const output = `  File "app.py", line 4
    if True
          ^
SyntaxError: expected ':'`;

      const diags = parseCompilerDiagnostics("python", output, "C:\\work\\app.py");
      expect(diags).toHaveLength(1);
      expect(diags[0].line).toBe(4);
      expect(diags[0].severity).toBe("error");
      expect(diags[0].message).toBe("SyntaxError: expected ':'");
    });
  });
});
