import { describe, it, expect } from "vitest";
import { findBraceProblem, parseCompilerDiagnostics, rewriteCompilerOutput } from "./diagnostics";

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
        outputLine: 0,
      });
    });

    it("moves old-gcc missing ';' errors to the end of the previous code line", () => {
      const source = [
        "int f(int u) {",
        "    int b = 0;",
        "    if (u) {",
        "        b = u * 3",
        "",
        "    } else {",
        "        b = 1;",
        "    }",
        "    printf(\"x\")",
        "    // comment",
        "    for (;;) {}",
        "}",
      ].join("\r\n");
      const output = `C:\\codes\\a.c:6:5: error: expected ';' before '}' token
C:\\codes\\a.c:11:5: error: expected ';' before 'for'
C:\\codes\\a.c:7:13: error: expected ';' before 'x'`;

      const diags = parseCompilerDiagnostics("c", output, "C:\\codes\\a.c", source);
      expect(diags.map((d) => [d.line, d.column, d.reportedLine])).toEqual([
        [4, 18, 6],
        [9, 16, 11],
        // Token is mid-line: the compiler's position is already right.
        [7, 13, undefined],
      ]);
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
        outputLine: 0,
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

describe("missing brace detection (real gcc 6/14, clang 17, javac 21 output)", () => {
  const missingOpenC = [
    "#include <stdio.h>",
    "",
    "int main() {",
    "    int n = 5; // number of elements",
    "    for (int i = 0; i < n - 1; i++) {",
    "        n--;",
    "    }",
    "    printf(\"Array after deletion:\\n\");",
    "    for (int i = 0; i < n; i++)",
    "        printf(\"%d \", i);",
    "    }",
    "",
    "    return 0;",
    "}",
  ].join("\r\n");

  it("points a missing '{' at the for loop, not at the later 'return' (gcc)", () => {
    const out = `C:\\codes\\avg.c:13:5: error: expected identifier or '(' before 'return'
C:\\codes\\avg.c:14:1: error: expected identifier or '(' before '}' token`;
    const diags = parseCompilerDiagnostics("c", out, "C:\\codes\\avg.c", missingOpenC);
    expect(diags).toHaveLength(3);
    expect(diags[0]).toMatchObject({ line: 9, column: 32, message: "missing '{' at the end of line 9" });
    expect(diags[0].hint).toContain("the '}' on line 11 closes the block from line 3");
  });

  it("does the same for clang and g++ wording", () => {
    const clang = `a.c:13:5: error: expected identifier or '('
a.c:14:1: error: extraneous closing brace ('}')`;
    const gxx = `a.cpp:13:5: error: expected unqualified-id before 'return'
a.cpp:14:1: error: expected declaration before '}' token`;
    expect(parseCompilerDiagnostics("c", clang, "a.c", missingOpenC)[0].line).toBe(9);
    expect(parseCompilerDiagnostics("cpp", gxx, "a.cpp", missingOpenC)[0].line).toBe(9);
  });

  it("finds a block that is never closed", () => {
    const src = [
      "int main() {",
      "    int n = 5;",
      "    for (int i = 0; i < n; i++) {",
      "        printf(\"%d \", i);",
      "",
      "    printf(\"done\\n\");",
      "    return 0;",
      "}",
    ].join("\n");
    const out = "main.c:8:1: error: expected declaration or statement at end of input";
    const [d] = parseCompilerDiagnostics("c", out, "main.c", src);
    expect(d).toMatchObject({ line: 4, message: "missing '}' to close the '{' on line 3" });
    expect(d.hint).toBe("The '{' on line 3 is never closed: add '}' after line 4.");
  });

  it("finds a missing '}' at the end of the file", () => {
    const src = "int main() {\n    if (1) {\n        f();\n    }\n    return 0;\n";
    const out = "main.c:5:5: error: expected declaration or statement at end of input";
    expect(parseCompilerDiagnostics("c", out, "main.c", src)[0].hint).toBe(
      "The '{' on line 1 is never closed: add '}' at the end of the file."
    );
  });

  it("finds a missing '{' in Java", () => {
    const src = [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        for (int i = 0; i < 3; i++)",
      "            System.out.println(\"{\" + i);",
      "        }",
      "",
      "        System.out.println(\"done\");",
      "    }",
      "}",
    ].join("\n");
    const out = `Main.java:7: error: <identifier> expected
Main.java:7: error: illegal start of type
Main.java:9: error: class, interface, enum, or record expected`;
    expect(parseCompilerDiagnostics("java", out, "Main.java", src)[0].line).toBe(3);
  });

  it("stays quiet for errors that are not about braces, even in unindented code", () => {
    const src = "int main() {\nprintf(\"x\");\nint y = undefined_var;\nreturn 0;\n}";
    const out = "flat.c:3:9: error: 'undefined_var' undeclared (first use in this function)";
    expect(parseCompilerDiagnostics("c", out, "flat.c", src)).toHaveLength(1);
  });

  it("accepts valid code: braceless loops, switch labels, initializers, comments", () => {
    const src = [
      "int a[] = {",
      "1, 2,",
      "};",
      "int main() {",
      "    /* { */ char c = '{';",
      "    switch (c) {",
      "    case 1:",
      "        break;",
      "    }",
      "    for (;;)",
      "        if (c) return 1; // }",
      "    return 0;",
      "}",
    ].join("\n");
    expect(findBraceProblem(src.split("\n"))).toBeNull();
  });
});

describe("errors reported on the line after the mistake (real g++ 14, gcc 14, sf output)", () => {
  const cpp = [
    "class info {",
    "public:",
    "    void get() {",
    "        cout << \"name : \" << endl",
    "        cin >> name;",
    "    }",
    "};",
  ].join("\r\n");
  // g++ 14 still names the next statement for a missing ';' in C++.
  const gxx = [
    "C:\\codes\\a.cpp: In member function 'void info::get()':",
    "C:\\codes\\a.cpp:5:9: error: expected ';' before 'cin'",
    "    5 |         cin >> name;",
    "      |         ^~~",
  ].join("\n");

  it("moves the marker to the end of the line that is missing ';'", () => {
    const [d] = parseCompilerDiagnostics("cpp", gxx, "C:\\codes\\a.cpp", cpp);
    expect(d).toMatchObject({ line: 4, column: 34, reportedLine: 5, message: "missing ';' at the end of line 4" });
  });

  it("rewrites the terminal output to name that line and quote it", () => {
    expect(rewriteCompilerOutput("cpp", gxx, "C:\\codes\\a.cpp", cpp).split("\r\n")).toEqual([
      "C:\\codes\\a.cpp: In member function 'void info::get()':",
      "C:\\codes\\a.cpp:4:34: error: missing ';' at the end of line 4",
      "    4 |         cout << \"name : \" << endl",
      "      |                                  ^",
    ]);
  });

  it("handles the old gcc quote format and \"',' or ';'\" wording", () => {
    const c = "int main() {\n    int a = 5\n    printf(\"%d\", a);\n}";
    const out = "a.c:3:5: error: expected ',' or ';' before 'printf'\n     printf(\"%d\", a);\n     ^~~~~~\na.c:9:1: error: something else";
    expect(rewriteCompilerOutput("c", out, "a.c", c).split("\r\n")).toEqual([
      "a.c:2:14: error: missing ',' or ';' at the end of line 2",
      "    2 |     int a = 5",
      "      |              ^",
      "a.c:9:1: error: something else",
    ]);
  });

  it("does the same for Salivo parser errors", () => {
    const sal = "func main() {\n    let a = 5\n    outln($\"{a}\");\n}";
    const out = [
      "Parser Error(s):",
      "  Line 3, Col 5: UnexpectedToken { expected: \"Semicolon\", found: \"Identifier\" }: Expected Semicolon, but found Identifier",
      "    --> outln($\"{a}\");",
    ].join("\n");
    expect(parseCompilerDiagnostics("salivo", out, "a.sal", sal)[0]).toMatchObject({ line: 2, column: 14 });
    expect(rewriteCompilerOutput("salivo", out, "a.sal", sal).split("\r\n")).toEqual([
      "Parser Error(s):",
      "  Line 2, Col 14: missing ';' at the end of line 2",
      "    --> let a = 5",
    ]);
  });

  it("reads Salivo semantic errors without moving them", () => {
    const out = "Semantic Error(s):\n  Line 3, Col 11: Undeclared variable 'b'\n    --> outln($\"{b}\");";
    const [d] = parseCompilerDiagnostics("salivo", out, "a.sal", "func main() {\n\n    outln($\"{b}\");\n}");
    expect(d).toMatchObject({ line: 3, column: 11, message: "Undeclared variable 'b'" });
    expect(d.reportedLine).toBeUndefined();
  });

  it("puts a missing brace first, before the compiler's later errors", () => {
    const src = "int main() {\n    for (;;)\n        f();\n    }\n    return 0;\n}";
    const out = "a.c:5:5: error: expected identifier or '(' before 'return'";
    expect(rewriteCompilerOutput("c", out, "a.c", src).split("\r\n").slice(0, 4)).toEqual([
      "a.c:2:13: error: missing '{' at the end of line 2",
      "    2 |     for (;;)",
      "      |             ^",
      "note: Line 2 is missing '{' at the end. Without it, the '}' on line 4 closes the block from line 1 instead, so the compiler reports errors further down.",
    ]);
  });

  it("leaves output that already points at the right line unchanged (clang)", () => {
    const out = "a.c:2:14: error: expected ';' at end of declaration\n    2 |     int a = 5\n      |              ^";
    expect(rewriteCompilerOutput("c", out, "a.c", "int main() {\n    int a = 5\n}")).toBe(out.split("\n").join("\r\n"));
  });
});
