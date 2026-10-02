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
  activePtySessions: string[];
  tools: Array<{
    name: string;
    path: string | null;
    available: boolean;
    purpose: string;
    installHint: string;
  }>;
}

export interface CompilerDiagnostic {
  file: string;
  line: number;
  column: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
  message: string;
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
    lines.push(`Active PTY Sessions: ${rustDiag.activePtySessions.length}`);

    lines.push("\n--- Toolchain Status ---");
    for (const tool of rustDiag.tools) {
      lines.push(
        `  ${tool.name.padEnd(10)}: ${tool.available ? "AVAILABLE (" + tool.path + ")" : "MISSING"} - ${tool.purpose}`
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
  if (typeof (window as any).monaco !== "undefined") {
    const monaco = (window as any).monaco;
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
  targetFilePath: string
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const lines = output.split(/\r?\n/);
  const targetNorm = normalizePathForCompare(targetFilePath);
  const targetBase = targetFilePath.split(/[/\\]/).pop()?.toLowerCase() || "";

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

          diagnostics.push({
            file: targetFilePath,
            line,
            column,
            endColumn: column + 5,
            severity,
            message,
          });
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

  return diagnostics;
}

/**
 * Applies compiler diagnostics to Monaco model markers
 */
export function applyCompilerMarkers(
  monaco: any,
  model: any,
  diagnostics: CompilerDiagnostic[]
) {
  if (!monaco || !model) return;

  const markers = diagnostics.map((d) => {
    let severity = monaco.MarkerSeverity.Error;
    if (d.severity === "warning") severity = monaco.MarkerSeverity.Warning;
    if (d.severity === "info") severity = monaco.MarkerSeverity.Info;

    return {
      severity,
      message: d.message,
      startLineNumber: d.line,
      startColumn: d.column,
      endLineNumber: d.line,
      endColumn: d.endColumn || d.column + 1,
      source: "compiler",
    };
  });

  monaco.editor.setModelMarkers(model, "codeui-compiler", markers);
}

/**
 * Clears compiler diagnostics from Monaco model markers
 */
export function clearCompilerMarkers(monaco: any, model: any) {
  if (!monaco || !model) return;
  monaco.editor.setModelMarkers(model, "codeui-compiler", []);
}
