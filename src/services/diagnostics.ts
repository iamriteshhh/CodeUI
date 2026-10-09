import { invoke, isTauri as isTauriCore } from "@tauri-apps/api/core";
import { notify } from "./notify";
import { editorService } from "./editorService";

const isTauri = () => {
  if (typeof window === "undefined") return false;
  try {
    return isTauriCore() || "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  } catch {
    return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  }
};

export interface SystemDiagnostics {
  version: string;
  gitSha: string;
  buildTime: string;
  profile: string;
  targetTriple: string;
  os: string;
  arch: string;
  family: string;
  executablePath?: string;
  currentDir?: string;
  settingsPath?: string;
  pathVar: string;
  defaultShell: string;
  resolvedShell?: string;
  runPathVar: string;
  activePtySessions: string[];
  ptySessionCount: number;
  tools: Array<{
    name: string;
    path: string | null;
    available: boolean;
    purpose: string;
    installHint: string;
    version?: string;
  }>;
  sandbox: {
    execution: "Supervised" | "Sandboxed";
    sandbox: string;
    network: "Allowed" | "Blocked";
    filesystem: string;
    resourceLimits: string[];
    notes: string[];
  };
  extensionPolicyVersion?: string;
}

export interface CompilerDiagnostic {
  file: string;
  line: number;
  column: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
  message: string;
  /** Line the compiler printed, when the marker was moved to where the fix belongs. */
  reportedLine?: number;
  /** Plain-language explanation printed under the raw compiler output. */
  hint?: string;
}

/**
 * Older gcc (e.g. MinGW 6.x on Windows) reports a missing ';' or ')' at the next
 * token, so a semicolon missing on line 16 shows up as "17:5: expected ';' before '}'".
 * When that token starts its line, the fix belongs at the end of the previous code line.
 */
function remapExpectedBefore(d: CompilerDiagnostic, sourceLines: string[]): CompilerDiagnostic {
  if (!/^expected '[^']+' before/.test(d.message)) return d;
  const current = sourceLines[d.line - 1];
  if (current === undefined || current.slice(0, d.column - 1).trim() !== "") return d;
  for (let i = d.line - 2; i >= 0; i--) {
    const text = sourceLines[i].trimEnd();
    const code = text.trim();
    if (!code || code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
    return {
      ...d,
      line: i + 1,
      column: text.length + 1,
      endColumn: text.length + 2,
      reportedLine: d.line,
      hint: `"${d.message}" at line ${d.line} means the fix belongs at the end of line ${i + 1}.`,
    };
  }
  return d;
}

/** Compiler messages that a misplaced or missing brace produces further down the file. */
const BRACE_SYMPTOM =
  /end of input|expected identifier or '\('|expected declaration|expected unqualified-id|expected '[{}]'|reached end of file while parsing|class, interface, enum, or record expected|illegal start of (type|expression)|extraneous closing brace|<identifier> expected/;

/** Source lines with comments removed and string/char contents blanked; columns are kept. */
function codeOnly(lines: string[]): string[] {
  let inComment = false;
  return lines.map((line) => {
    let out = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inComment) {
        if (c === "*" && line[i + 1] === "/") {
          inComment = false;
          out += " ";
          i++;
        }
        out += " ";
      } else if (c === "/" && line[i + 1] === "/") {
        break;
      } else if (c === "/" && line[i + 1] === "*") {
        inComment = true;
        out += "  ";
        i++;
      } else if (c === '"' || c === "'") {
        out += c;
        for (i++; i < line.length && line[i] !== c; i++) {
          if (line[i] === "\\") {
            out += " ";
            i++;
          }
          out += " ";
        }
        out += c;
      } else {
        out += c;
      }
    }
    return out.trimEnd();
  });
}

function indentOf(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === " ") width++;
    else if (ch === "\t") width += 4 - (width % 4);
    else break;
  }
  return width;
}

/**
 * Finds a missing '{' or '}' the way an IDE does: by comparing braces with indentation.
 * The compiler cannot: without the '{' after `for (...)` the code is still valid C up to
 * the point where an early '}' closes the function, so gcc complains lines later.
 * Returns null unless the answer is clear.
 * ponytail: indentation heuristic, a real parser would also catch unindented code.
 */
export function findBraceProblem(sourceLines: string[]): { line: number; column: number; message: string; hint: string } | null {
  const code = codeOnly(sourceLines);
  const stack: { line: number; indent: number; block: boolean; indented?: boolean }[] = [];
  const nextCode = (i: number) => code.findIndex((t, j) => j > i && t.trim() !== "");
  const prevCode = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (code[j].trim()) return j;
    return -1;
  };

  // A header such as `for (...)`, `if (...)`, `int main()` or `else` with no '{',
  // at `indent`, whose next line is indented as if a block had been opened.
  const headerWithoutBrace = (from: number, to: number, indent: number) => {
    for (let j = to - 1; j >= from; j--) {
      const t = code[j].trim();
      if (!t || indentOf(code[j]) !== indent || t.includes("{")) continue;
      if (!/\)$|^(\}\s*)?(else|do)$/.test(t)) continue;
      const next = nextCode(j);
      if (next !== -1 && indentOf(code[next]) > indent) return j;
    }
    return -1;
  };
  const missingOpen = (header: number, close: number, opener?: number) => ({
    line: header + 1,
    column: code[header].length + 1,
    message: `missing '{' at the end of line ${header + 1}`,
    hint:
      `Line ${header + 1} is missing '{' at the end. ` +
      (opener === undefined
        ? `Without it, the '}' on line ${close + 1} has nothing to close.`
        : `Without it, the '}' on line ${close + 1} closes the block from line ${opener + 1} instead, so the compiler reports errors further down.`),
  });
  const missingClose = (opener: number, before: number) => {
    const last = prevCode(before);
    return {
      line: last + 1,
      column: code[last].length + 1,
      message: `missing '}' to close the '{' on line ${opener + 1}`,
      hint:
        before < code.length
          ? `The '{' on line ${opener + 1} is never closed: add '}' after line ${last + 1}.`
          : `The '{' on line ${opener + 1} is never closed: add '}' at the end of the file.`,
    };
  };

  for (let i = 0; i < code.length; i++) {
    const t = code[i].trim();
    if (!t || t.startsWith("#")) continue;
    const indent = indentOf(code[i]);
    const top = stack[stack.length - 1];

    if (top && !t.startsWith("}")) {
      // Only blocks whose body is indented can tell where they should have ended.
      if (top.indented === undefined) top.indented = indent > top.indent;
      const isLabel = /^(case\b|default\b|[A-Za-z_]\w*\s*:(?!:))/.test(t);
      if (top.block && top.indented && indent <= top.indent && !isLabel) {
        return missingClose(top.line, i);
      }
    }

    const lineStart = code[i].length - code[i].trimStart().length;
    for (let k = lineStart; k < code[i].length; k++) {
      const c = code[i][k];
      if (c === "{") {
        const before = code[i].slice(0, k).trim();
        stack.push({ line: i, indent, block: !/([=,([]|\breturn)$/.test(before) });
      } else if (c === "}") {
        const open = stack.pop();
        if (!open) {
          const header = headerWithoutBrace(0, i, indent);
          if (header >= 0) return missingOpen(header, i);
          return { line: i + 1, column: k + 1, message: "unmatched '}'", hint: `The '}' on line ${i + 1} has no matching '{'.` };
        }
        if (k === lineStart && open.block && open.indent !== indent) {
          const header = headerWithoutBrace(open.line + 1, i, indent);
          if (header >= 0) return missingOpen(header, i, open.line);
        }
      }
    }
  }

  const open = stack[stack.length - 1];
  return open ? missingClose(open.line, code.length) : null;
}

export async function fetchSystemDiagnostics(): Promise<SystemDiagnostics | null> {
  if (isTauri()) {
    try {
      return await invoke<SystemDiagnostics>("get_diagnostics");
    } catch (err) {
      console.error("Failed to invoke get_diagnostics:", err);
      return null;
    }
  }
  return null;
}

export async function generateDiagnosticsReport(): Promise<string> {
  const rustDiag = await fetchSystemDiagnostics();

  const lines: string[] = [];
  lines.push("=== CodeUI System Diagnostics Report ===");
  lines.push(`Generated At: ${new Date().toISOString()}`);

  if (rustDiag) {
    lines.push(`CodeUI Version: ${rustDiag.version}`);
    lines.push(`Git Commit SHA: ${rustDiag.gitSha}`);
    lines.push(`Build Profile: ${rustDiag.profile} (${rustDiag.targetTriple})`);
    lines.push(`Build Timestamp: ${rustDiag.buildTime}`);
    lines.push(`OS: ${rustDiag.os} (${rustDiag.arch}, ${rustDiag.family})`);
    lines.push(`Executable: ${rustDiag.executablePath || "unknown"}`);
    lines.push(`Current Dir: ${rustDiag.currentDir || "unknown"}`);
    lines.push(`Settings File: ${rustDiag.settingsPath || "unknown"}`);
    lines.push(`Default Shell: ${rustDiag.defaultShell} (Resolved: ${rustDiag.resolvedShell || "NOT FOUND"})`);
    lines.push(`Active PTY Sessions: ${rustDiag.ptySessionCount}`);
    lines.push(`PATH: ${rustDiag.pathVar}`);
    lines.push(`Run PATH: ${rustDiag.runPathVar}`);
    lines.push(`Extension Policy Version: ${rustDiag.extensionPolicyVersion ?? "unversioned"}`);

    const sb = rustDiag.sandbox;
    lines.push("\n--- Execution Isolation ---");
    lines.push(`Execution: ${sb.execution}`);
    lines.push(`Sandbox: ${sb.sandbox}`);
    lines.push(`Network: ${sb.network}`);
    lines.push(`Filesystem: ${sb.filesystem}`);
    for (const limit of sb.resourceLimits) lines.push(`  Limit: ${limit}`);
    for (const note of sb.notes) lines.push(`  Note: ${note}`);

    lines.push("\n--- Toolchain Status ---");
    for (const tool of rustDiag.tools) {
      lines.push(
        `  ${tool.name.padEnd(10)}: ${tool.available ? `AVAILABLE (${tool.path}${tool.version ? ", " + tool.version : ""})` : "MISSING"} - ${tool.purpose}`
      );
    }
  } else {
    lines.push("Tauri Backend: Not connected (Running in Web/Mock Mode)");
  }

  // Frontend & WebView context
  lines.push("\n--- Frontend & WebView Environment ---");
  if (typeof window !== "undefined") {
    lines.push(`User Agent: ${navigator.userAgent}`);
    lines.push(`Screen Size: ${window.innerWidth}x${window.innerHeight} (DPI Scale: ${window.devicePixelRatio})`);
    if (document.fonts) {
      const fontCheck = document.fonts.check('14px "CodeUI Mono"');
      lines.push(`Font "CodeUI Mono" status: ${fontCheck ? "LOADED" : "FALLBACK"}`);
    }
  }

  // Monaco stats
  const monaco = (window as { monaco?: typeof import("../monaco") }).monaco;
  if (monaco) {
    const editors = monaco.editor.getEditors ? monaco.editor.getEditors().length : 0;
    const models = monaco.editor.getModels ? monaco.editor.getModels().length : 0;
    lines.push(`Monaco Editors Count: ${editors}`);
    lines.push(`Monaco Models Count: ${models}`);
  }

  const activeEditor = editorService.getActiveEditor();
  if (activeEditor) {
    try {
      const layout = activeEditor.getLayoutInfo ? activeEditor.getLayoutInfo() : null;
      if (layout) {
        lines.push(`Active Editor Dimensions: ${layout.width}x${layout.height}`);
      }
    } catch {}
  }

  return lines.join("\n");
}

export async function copyDiagnosticsToClipboard(): Promise<void> {
  try {
    const report = await generateDiagnosticsReport();
    await navigator.clipboard.writeText(report);
    notify.success("Diagnostics Copied", "Full system report has been copied to your clipboard.");
  } catch (err) {
    console.error("Failed to copy diagnostics:", err);
    notify.error("Copy Failed", "Could not write diagnostics report to clipboard.");
  }
}

/**
 * Normalizes file paths for diagnostic matching across Windows drive letters and Unix slashes
 */
function normalizePathForCompare(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().trim();
}

/**
 * Pure TypeScript parser for compiler diagnostic output (gcc, g++, clang, javac, python).
 * Zero external dependencies.
 */
export function parseCompilerDiagnostics(
  language: string,
  output: string,
  targetFilePath: string,
  source?: string
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const lines = output.split(/\r?\n/);
  const targetNorm = normalizePathForCompare(targetFilePath);
  const targetBase = targetFilePath.split(/[/\\]/).pop()?.toLowerCase() || "";
  const sourceLines = source?.split(/\r?\n/);

  const isMatchingFile = (cand: string) => {
    const candNorm = normalizePathForCompare(cand);
    const candBase = cand.split(/[/\\]/).pop()?.toLowerCase() || "";
    return (
      candNorm === targetNorm ||
      candNorm.endsWith("/" + targetBase) ||
      candBase === targetBase
    );
  };

  if (language === "c" || language === "cpp" || language === "rust") {
    // gcc/clang/rustc format: file:line:col: (error|warning|note|fatal error): message
    // regex handles Windows drive letters: "C:\dir\file.c:12:5: error: ..."
    const gccRegex = /^(?<file>.+?):(?<line>\d+):(?<col>\d+):\s+(?<sev>fatal error|error|warning|note):\s+(?<msg>.*)$/i;

    for (let i = 0; i < lines.length; i++) {
      const match = gccRegex.exec(lines[i].trim());
      if (match && match.groups) {
        const file = match.groups.file;
        const line = parseInt(match.groups.line, 10);
        const column = parseInt(match.groups.col, 10);
        const sevStr = match.groups.sev.toLowerCase();
        const message = match.groups.msg.trim();

        if (isMatchingFile(file)) {
          let severity: "error" | "warning" | "info" = "error";
          if (sevStr === "warning") severity = "warning";
          else if (sevStr === "note") severity = "info";

          const diag: CompilerDiagnostic = {
            file: targetFilePath,
            line,
            column,
            endColumn: column + 5,
            severity,
            message,
          };
          diagnostics.push(sourceLines ? remapExpectedBefore(diag, sourceLines) : diag);
        }
      }
    }
  } else if (language === "java") {
    // javac format: File.java:line: (error|warning): message
    const javacRegex = /^(?<file>.+?\.java):(?<line>\d+):\s+(?<sev>error|warning):\s+(?<msg>.*)$/i;

    for (let i = 0; i < lines.length; i++) {
      const match = javacRegex.exec(lines[i].trim());
      if (match && match.groups) {
        const file = match.groups.file;
        const line = parseInt(match.groups.line, 10);
        const sevStr = match.groups.sev.toLowerCase();
        const message = match.groups.msg.trim();

        let column = 1;
        // Peek subsequent lines for caret column position "^"
        if (i + 2 < lines.length && lines[i + 2].includes("^")) {
          const caretIdx = lines[i + 2].indexOf("^");
          if (caretIdx >= 0) column = caretIdx + 1;
        }

        if (isMatchingFile(file)) {
          diagnostics.push({
            file: targetFilePath,
            line,
            column,
            endColumn: column + 4,
            severity: sevStr === "warning" ? "warning" : "error",
            message,
          });
        }
      }
    }
  } else if (language === "python") {
    // Python traceback & SyntaxError format
    // Traceback: File "...", line 12, in <module>
    // SyntaxError: ...
    const pyTraceRegex = /File\s+["'](?<file>.+?)["'],\s+line\s+(?<line>\d+)/i;

    for (let i = 0; i < lines.length; i++) {
      const match = pyTraceRegex.exec(lines[i]);
      if (match && match.groups) {
        const file = match.groups.file;
        const line = parseInt(match.groups.line, 10);

        if (isMatchingFile(file)) {
          // Look ahead for the error message
          let message = "Python runtime error";
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            const nextTrim = lines[j].trim();
            if (nextTrim && !nextTrim.startsWith("File ") && !nextTrim.startsWith("^")) {
              message = nextTrim;
            }
          }

          diagnostics.push({
            file: targetFilePath,
            line,
            column: 1,
            endColumn: 80,
            severity: "error",
            message,
          });
        }
      }
    }
  }

  // A brace error surfaces lines later; put the real location first, as an IDE would.
  const firstError = diagnostics.find((d) => d.severity === "error");
  if (sourceLines && language !== "python" && firstError && diagnostics.some((d) => BRACE_SYMPTOM.test(d.message))) {
    const problem = findBraceProblem(sourceLines);
    if (problem && problem.line <= (firstError.reportedLine ?? firstError.line)) {
      diagnostics.unshift({
        file: targetFilePath,
        ...problem,
        endColumn: problem.column + 1,
        severity: "error",
      });
    }
  }

  return diagnostics;
}
