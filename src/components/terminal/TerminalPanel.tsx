import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptyService } from "../../services/ptyService";
import { processService } from "../../services/processService";
import { rewriteCompilerOutput } from "../../services/diagnostics";
import { editorService } from "../../services/editorService";
import { markTerminalReady, WORKSPACE_RESET_EVENT } from "../../services/terminalReady";
import { Trash2, RotateCw, Terminal as TerminalIcon, Plus, Play, Square, Columns2, Rows2, X, Eraser } from "lucide-react";

/** detail of the "codeui-run-start" event dispatched by runActiveFile. */
interface RunStartDetail {
  runId: string;
  name: string;
  language: string;
  path: string;
  /** Set here: the size the program's terminal starts with. */
  size?: { cols: number; rows: number };
  /** Set here: resolves once this panel is listening, so no early output is lost. */
  ready?: Promise<void>;
  /** Set here: the run could not start (unsupported file, missing compiler). */
  fail?: (message: string) => void;
}

/**
 * xterm turns every Ctrl+letter and F-key into terminal input and swallows the
 * event. Returning false here hands the key back to the browser instead: copy
 * when text is selected, native paste, and the app's own shortcuts.
 */
const attachClipboardAndShortcuts = (term: Terminal) =>
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Ctrl+C copies only with a selection, so it still interrupts otherwise. Ctrl+Shift+C always copies.
    if (mod && key === "c" && (e.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
      e.preventDefault();
      return false;
    }
    // Ctrl+V / Ctrl+Shift+V: let the browser fire its paste event, which xterm handles.
    if (mod && key === "v") return false;
    if (e.key === "F5" || (mod && !e.shiftKey && ["s", "p", "n", "o", "b"].includes(key))) return false;
    // Editor tabs (Ctrl+PageUp/PageDown) and New Terminal (Ctrl+Shift+`) belong to the app too.
    if (e.ctrlKey && (e.key === "PageDown" || e.key === "PageUp")) return false;
    if (mod && e.shiftKey && e.code === "Backquote") return false;
    return true;
  });

/** 850 -> "850ms", 1000 -> "1s", 1234 -> "1.2s". */
const formatDuration = (ms: number) =>
  ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;

/** Windows crash codes (NTSTATUS) arrive as negative numbers; show them as 0xC0000005. */
const formatExitCode = (code: number) =>
  code < 0 ? "0x" + (code >>> 0).toString(16).toUpperCase() : String(code);

interface TerminalPanelProps {
  sessionId: string | null;
  workspacePath?: string;
  onEnsureSession?: (preferredId?: string) => Promise<string>;
  /** The main shell was restarted under a new id (Restart / Kill), for "Send to Terminal". */
  onSessionReplaced?: (sessionId: string) => void;
  /** Stack panes top to bottom (panel docked beside the editor) instead of side by side. */
  stacked?: boolean;
}

const XTERM_DARK_THEME = {
  background: "#181818",
  foreground: "#cccccc",
  cursor: "#ffffff",
  cursorAccent: "#181818",
  selectionBackground: "rgba(0, 122, 204, 0.35)",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#858585",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
};

const XTERM_LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#333333",
  cursorAccent: "#ffffff",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#cd3131",
  green: "#008000",
  yellow: "#795e26",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#008000",
  brightYellow: "#795e26",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

const getXtermTheme = () => {
  if (
    typeof document !== "undefined" &&
    (document.documentElement.getAttribute("data-theme") === "light" ||
      document.documentElement.dataset.theme === "light")
  ) {
    return XTERM_LIGHT_THEME;
  }
  return XTERM_DARK_THEME;
};

const XTERM_BASE_OPTIONS = {
  fontFamily: '"CodeUI Mono", Consolas, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.25,
  cursorBlink: true,
  cursorStyle: "bar" as const,
  cursorInactiveStyle: "bar" as const,
  cursorWidth: 2,
  convertEol: false,
  scrollback: 5000,
  allowTransparency: false,
};

const RUN_BANNER = "\x1b[90m[CodeUI Supervised Runner — press F5 or click Run to execute active file]\x1b[0m\r\n";

/** A shell pane the panel can clear or write to. */
interface ShellPane {
  term: Terminal;
  sid: string;
}

/**
 * Second shell shown beside the main one (the split button). Owns its own shell
 * process: started on mount in `cwd`, killed on unmount.
 */
const SplitShell: React.FC<{
  cwd?: string;
  paneRef: React.MutableRefObject<ShellPane | null>;
  onFocus: () => void;
  /** The shell exited (`exit`): the pane closes. */
  onExit: () => void;
  /** Hidden while Run uses the second pane; the shell keeps running behind it. */
  hidden?: boolean;
}> = ({ cwd, paneRef, onFocus, onExit, hidden = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const term = new Terminal({ ...XTERM_BASE_OPTIONS, theme: getXtermTheme() });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    attachClipboardAndShortcuts(term);
    const sid = "pty-" + Math.random().toString(36).substring(2, 10);
    paneRef.current = { term, sid };
    const size = () => ({ cols: Math.max(term.cols || 80, 20), rows: Math.max(term.rows || 24, 4) });
    let disposed = false;
    const unlisten: (() => void)[] = [];
    const keep = (un: () => void) => (disposed ? un() : unlisten.push(un));

    (async () => {
      // Listen before spawning so the first prompt is not lost.
      keep(await ptyService.onPtyData(sid, (chunk) => term.write(chunk)));
      keep(await ptyService.onPtyExit(sid, () => onExitRef.current()));
      if (disposed) return;
      try {
        fit.fit();
      } catch {}
      await ptyService.spawnPty({ sessionId: sid, ...size(), cwd });
      if (disposed) ptyService.killPty(sid).catch(() => {});
    })().catch((err) => {
      if (!disposed) term.writeln(`\x1b[31m[Could not start a shell: ${err}]\x1b[0m`);
    });

    term.onData((data) => {
      ptyService.writePty(sid, data).catch(() => {});
    });
    const resizeObserver = new ResizeObserver(() => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fit.fit();
        const { cols, rows } = size();
        ptyService.resizePty(sid, cols, rows).catch(() => {});
      } catch {}
    });
    resizeObserver.observe(container);
    term.focus();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      unlisten.forEach((un) => un());
      ptyService.killPty(sid).catch(() => {});
      term.dispose();
      paneRef.current = null;
    };
  }, []);

  return (
    <div
      className="terminal-xterm-viewport terminal-split-pane"
      ref={containerRef}
      data-testid="split-terminal"
      style={{ display: hidden ? "none" : "block" }}
      onMouseDown={() => paneRef.current?.term.focus()}
      onFocus={onFocus}
    />
  );
};

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  sessionId,
  workspacePath,
  onEnsureSession,
  onSessionReplaced,
  stacked = false,
}) => {
  const [activeTab, setActiveTab] = useState<"shell" | "run">("shell");
  const [shellName, setShellName] = useState<string>("terminal");
  const [runFileName, setRunFileName] = useState<string | null>(null);
  const [runActive, setRunActive] = useState<boolean>(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // Split on the shell tab: a second shell. Split on the Run tab: the existing shell
  // shown beside Run (no new shell).
  const [splitOpen, setSplitOpen] = useState(false);
  const [runBeside, setRunBeside] = useState(false);
  const splitPaneRef = useRef<ShellPane | null>(null);
  // Pane last focused: what Clear and Kill act on when several are shown.
  const focusedPaneRef = useRef<"main" | "split" | "run">("main");

  const shellContainerRef = useRef<HTMLDivElement>(null);
  const runContainerRef = useRef<HTMLDivElement>(null);

  const shellTermRef = useRef<Terminal | null>(null);
  const runTermRef = useRef<Terminal | null>(null);

  const shellFitRef = useRef<FitAddon | null>(null);
  const runFitRef = useRef<FitAddon | null>(null);

  const sessionRef = useRef<string | null>(sessionId);
  // Latest callback: the store recreates it when the workspace (cwd) changes.
  const onEnsureSessionRef = useRef(onEnsureSession);
  onEnsureSessionRef.current = onEnsureSession;
  const respawningRef = useRef(false);
  // The main shell exited; the next keystroke restarts it (see onData).
  const shellExitedRef = useRef(false);
  // Latest restart handler, for the mount-time onData closure (it reads the current folder).
  const restartShellRef = useRef<() => void>(() => {});
  const shellUnlistenRef = useRef<{ data?: () => void; exit?: () => void }>({});
  const runUnlistenRef = useRef<{ output?: () => void; status?: () => void; data?: () => void }>({});

  // Centralized listener binder for the shell PTY session
  const attachShellSession = async (sid: string) => {
    if (sessionRef.current === sid && shellUnlistenRef.current.data) {
      return;
    }
    if (shellUnlistenRef.current.data) shellUnlistenRef.current.data();
    if (shellUnlistenRef.current.exit) shellUnlistenRef.current.exit();
    shellUnlistenRef.current = {};

    sessionRef.current = sid;

    const unData = await ptyService.onPtyData(sid, (chunk) => {
      shellTermRef.current?.write(chunk);
    });
    const unExit = await ptyService.onPtyExit(sid, () => {
      shellExitedRef.current = true;
      shellTermRef.current?.writeln("\r\n\x1b[33m[Shell process exited. Press any key to start a new shell.]\x1b[0m");
    });

    shellUnlistenRef.current = { data: unData, exit: unExit };
  };

  // Lazily start a shell (in the current workspace) after a workspace reset dropped the old one.
  const respawnShell = async () => {
    const ensure = onEnsureSessionRef.current;
    if (respawningRef.current || !ensure) return;
    respawningRef.current = true;
    try {
      shellTermRef.current?.reset();
      // Listen before spawning so the first prompt is not lost.
      const preferred = "pty-" + Math.random().toString(36).substring(2, 10);
      await attachShellSession(preferred);
      const sid = await ensure(preferred);
      if (!sid) {
        sessionRef.current = null;
        shellTermRef.current?.writeln("\x1b[31m[Could not start a shell. Press any key to retry.]\x1b[0m");
        return;
      }
      if (sid !== preferred) await attachShellSession(sid);
      const term = shellTermRef.current;
      if (term) {
        try {
          shellFitRef.current?.fit();
        } catch {}
        ptyService.resizePty(sid, Math.max(term.cols || 80, 20), Math.max(term.rows || 24, 4));
      }
    } finally {
      respawningRef.current = false;
    }
  };

  useEffect(() => {
    if (!sessionId || sessionId === sessionRef.current) return;
    attachShellSession(sessionId);
  }, [sessionId]);

  // Initialize both XTerm instances (Shell & Run)
  useEffect(() => {
    if (!shellContainerRef.current || !runContainerRef.current) return;
    let isDisposed = false;

    // 1. Shell terminal
    const shellTerm = new Terminal({
      ...XTERM_BASE_OPTIONS,
      theme: getXtermTheme(),
    });
    const shellFit = new FitAddon();
    shellTerm.loadAddon(shellFit);
    shellTerm.open(shellContainerRef.current);
    attachClipboardAndShortcuts(shellTerm);
    shellTermRef.current = shellTerm;
    shellFitRef.current = shellFit;

    shellTerm.onData((input) => {
      if (shellExitedRef.current) {
        shellExitedRef.current = false;
        restartShellRef.current();
        return;
      }
      const current = sessionRef.current;
      if (current) {
        ptyService.writePty(current, input).catch((err) => {
          console.error("[TerminalPanel] writePty error:", err);
        });
      } else {
        respawnShell();
      }
    });

    // 2. Run terminal (dedicated for build & program execution)
    const runTerm = new Terminal({
      ...XTERM_BASE_OPTIONS,
      theme: getXtermTheme(),
    });
    const runFit = new FitAddon();
    runTerm.loadAddon(runFit);
    runTerm.open(runContainerRef.current);
    attachClipboardAndShortcuts(runTerm);
    runTermRef.current = runTerm;
    runFitRef.current = runFit;

    runTerm.writeln(RUN_BANNER);

    // Detect default shell name
    ptyService.getDefaultShell().then((sh) => {
      if (sh.toLowerCase().includes("powershell")) {
        setShellName("powershell");
      } else if (sh.toLowerCase().includes("cmd")) {
        setShellName("cmd");
      } else if (sh.toLowerCase().includes("bash")) {
        setShellName("bash");
      } else {
        setShellName("terminal");
      }
    });

    // Setup initial shell session
    const setupShellSession = async () => {
      try {
        let sid = sessionId || sessionRef.current;
        if (!sid && onEnsureSession) {
          sid = await onEnsureSession();
        } else if (!sid) {
          sid = "pty-" + Math.random().toString(36).substring(2, 10);
        }

        if (isDisposed) return;
        await attachShellSession(sid);
        if (isDisposed) return;

        const cols = Math.max(shellTerm.cols || 80, 20);
        const rows = Math.max(shellTerm.rows || 24, 4);
        if (onEnsureSession) {
          const actualSid = await onEnsureSession(sid);
          if (actualSid && !isDisposed) {
            await attachShellSession(actualSid);
            sid = actualSid;
          }
        } else {
          await ptyService.spawnPty({
            sessionId: sid,
            cols,
            rows,
            cwd: workspacePath,
          });
        }

        if (!isDisposed && shellContainerRef.current) {
          try {
            shellFit.fit();
            ptyService.resizePty(sid, Math.max(shellTerm.cols || 80, 20), Math.max(shellTerm.rows || 24, 4));
          } catch {}
        }
      } catch (err) {
        console.error("[TerminalPanel] Failed to setup shell session:", err);
      }
    };

    setupShellSession();

    // Listen for codeui-run-start events from workspace store
    const handleRunStart = (e: Event) => {
      const detail = (e as CustomEvent<RunStartDetail>).detail;
      const { runId, name, language, path } = detail;
      setActiveTab("run");
      setRunFileName(name);
      setActiveRunId(runId);
      setRunActive(true);

      const rTerm = runTermRef.current;
      if (!rTerm) return;

      // Hidden (shell tab active) the Run terminal cannot measure itself; both tabs
      // share one viewport, so take the shell terminal's size instead.
      const shown = shellTermRef.current;
      if (rTerm.element?.offsetParent === null && shown) {
        rTerm.resize(shown.cols, shown.rows);
      } else {
        try {
          runFitRef.current?.fit();
        } catch {}
      }
      detail.size = { cols: rTerm.cols, rows: rTerm.rows };

      rTerm.clear();
      rTerm.writeln(`\x1b[36m[Compiling ${language}...]\x1b[0m\r\n`);
      rTerm.focus();

      // Clean up previous run listeners
      if (runUnlistenRef.current.output) runUnlistenRef.current.output();
      if (runUnlistenRef.current.status) runUnlistenRef.current.status();
      if (runUnlistenRef.current.data) runUnlistenRef.current.data();

      // Route keyboard input directly to program's dedicated PTY stdin
      const sendInput = (data: string) =>
        processService.writeRunStdin(runId, data).catch((err) => {
          console.error("[Run Terminal] writeRunStdin error:", err);
        });
      // Keys typed while compiling are held and sent once the program starts.
      let typeAhead: string | null = "";
      let closeAfterTypeAhead = false;
      const dataDisp = rTerm.onData((data) => {
        if (data === "\x03") {
          processService.stopRun(runId).catch(() => {});
        } else if (data === "\x1a") {
          // While compiling there is no program yet: end its input right after it starts.
          if (typeAhead !== null) closeAfterTypeAhead = true;
          else processService.closeRunStdin(runId).catch(() => {});
        } else if (typeAhead !== null) {
          typeAhead += data;
        } else {
          sendInput(data);
        }
      });

      let unOut: (() => void) | undefined;
      let unStat: (() => void) | undefined;
      // Compiler output is held until the build ends, then shown with each error on
      // the line that needs the fix (the compiler often names the next line instead).
      let compileOutput: string | null = "";
      let compilerSaid = "";
      const flushCompileOutput = () => {
        if (compileOutput === null) return;
        const source = editorService.getText(path) ?? undefined;
        if (compileOutput) rTerm.write(rewriteCompilerOutput(language, compileOutput, path, source));
        compilerSaid = compileOutput;
        compileOutput = null;
      };

      const outputReady = processService
        .onRunOutput(runId, (chunk) => {
          if (compileOutput !== null) compileOutput += chunk.chunk;
          else rTerm.write(chunk.chunk);
        })
        .then((un) => {
          unOut = un;
        });

      const statusReady = processService
        .onRunStatus(runId, (status) => {
          if (status.phase !== "compiling") flushCompileOutput();
          if (status.phase === "running") {
            rTerm.writeln(`\r\n\x1b[32m[Running ${name} (PID: ${status.pid})]\x1b[0m\r\n`);
            // The program's terminal starts at the size measured before the Run pane was
            // laid out (beside a split it is narrower); match it now that the program exists.
            processService.resizeRun(runId, rTerm.cols, rTerm.rows).catch(() => {});
            const held = typeAhead;
            typeAhead = null;
            // In order: the held keys reach the program before its input is closed.
            (held ? sendInput(held) : Promise.resolve()).then(() => {
              if (closeAfterTypeAhead) processService.closeRunStdin(runId).catch(() => {});
            });
          } else if (status.phase === "compileFailed") {
            rTerm.writeln(
              `\r\n\x1b[31m[Build failed (exit code ${formatExitCode(status.exitCode ?? 1)})]\x1b[0m\r\n`
            );
            // Old Windows compilers (MinGW gcc 6, ...) cannot open paths outside the system
            // code page and only say "no input files".
            if (/[^\x00-\x7f]/.test(path) && /no input files|No such file or directory/i.test(compilerSaid)) {
              rTerm.writeln(
                "\x1b[33m[Hint: This compiler cannot read file or folder names with non-English letters. " +
                  "Rename them using English letters only, or install a newer compiler (MSYS2 UCRT gcc).]\x1b[0m\r\n"
              );
            }
            setRunActive(false);
          } else if (status.phase === "finished") {
            const dur = formatDuration(status.durationMs ?? 0);
            rTerm.writeln(
              status.stoppedByUser
                ? `\r\n\x1b[33m[Stopped by you after ${dur}]\x1b[0m\r\n`
                : `\r\n\x1b[90m[Process exited with code ${formatExitCode(status.exitCode ?? 0)} in ${dur}]\x1b[0m\r\n`
            );
            if (status.hint) {
              rTerm.writeln(`\x1b[33m[Hint: ${status.hint}]\x1b[0m\r\n`);
            }
            setRunActive(false);
          } else if (status.phase === "failed") {
            rTerm.writeln(`\r\n\x1b[31m[Execution Failed: ${status.message}]\x1b[0m\r\n`);
            setRunActive(false);
          }
        })
        .then((un) => {
          unStat = un;
        });
      detail.ready = Promise.all([outputReady, statusReady]).then(() => {});
      detail.fail = (message) => {
        flushCompileOutput();
        rTerm.writeln(`\r\n\x1b[31m[Could not run: ${message}]\x1b[0m\r\n`);
        setRunActive(false);
      };

      const resizeDisp = rTerm.onResize(({ cols, rows }) => {
        processService.resizeRun(runId, cols, rows).catch(() => {});
      });

      runUnlistenRef.current = {
        output: () => unOut?.(),
        status: () => unStat?.(),
        data: () => {
          dataDisp.dispose();
          resizeDisp.dispose();
        },
      };
    };

    // Workspace switched/closed: the backend killed every PTY and run, so drop all bindings.
    // A new shell starts in the new folder on the next keystroke (or New Terminal).
    const handleWorkspaceReset = () => {
      if (shellUnlistenRef.current.data) shellUnlistenRef.current.data();
      if (shellUnlistenRef.current.exit) shellUnlistenRef.current.exit();
      shellUnlistenRef.current = {};
      sessionRef.current = null;
      if (runUnlistenRef.current.output) runUnlistenRef.current.output();
      if (runUnlistenRef.current.status) runUnlistenRef.current.status();
      if (runUnlistenRef.current.data) runUnlistenRef.current.data();
      runUnlistenRef.current = {};
      setRunActive(false);
      setActiveRunId(null);
      setRunFileName(null);
      setActiveTab("shell");
      setSplitOpen(false);
      setRunBeside(false);
      shellTerm.reset();
      shellTerm.writeln("\x1b[90m[Folder changed. Press any key to start a new shell.]\x1b[0m");
      runTerm.reset();
      runTerm.writeln(RUN_BANNER);
    };

    window.addEventListener("codeui-run-start", handleRunStart);
    window.addEventListener(WORKSPACE_RESET_EVENT, handleWorkspaceReset);
    markTerminalReady();

    // Resize observer
    const resizeObserver = new ResizeObserver((entries) => {
      if (isDisposed) return;
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          try {
            shellFit.fit();
            runFit.fit();
            const sid = sessionRef.current;
            if (sid && shellTerm.cols > 0 && shellTerm.rows > 0) {
              ptyService.resizePty(sid, Math.max(shellTerm.cols, 20), Math.max(shellTerm.rows, 4));
            }
          } catch {}
        }
      }
    });

    if (shellContainerRef.current) resizeObserver.observe(shellContainerRef.current);
    if (runContainerRef.current) resizeObserver.observe(runContainerRef.current);

    return () => {
      isDisposed = true;
      window.removeEventListener("codeui-run-start", handleRunStart);
      window.removeEventListener(WORKSPACE_RESET_EVENT, handleWorkspaceReset);
      resizeObserver.disconnect();
      if (shellUnlistenRef.current.data) shellUnlistenRef.current.data();
      if (shellUnlistenRef.current.exit) shellUnlistenRef.current.exit();
      shellUnlistenRef.current = {};
      if (runUnlistenRef.current.output) runUnlistenRef.current.output();
      if (runUnlistenRef.current.status) runUnlistenRef.current.status();
      if (runUnlistenRef.current.data) runUnlistenRef.current.data();
      runUnlistenRef.current = {};
      shellTerm.dispose();
      runTerm.dispose();
      shellTermRef.current = null;
      runTermRef.current = null;
      shellFitRef.current = null;
      runFitRef.current = null;
    };
  }, []);

  // Synchronize terminal theme dynamically with the application theme
  useEffect(() => {
    const updateTheme = () => {
      const theme = getXtermTheme();
      if (shellTermRef.current) shellTermRef.current.options.theme = theme;
      if (runTermRef.current) runTermRef.current.options.theme = theme;
      if (splitPaneRef.current) splitPaneRef.current.term.options.theme = theme;
    };
    if (typeof document === "undefined") return;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === "data-theme") {
          updateTheme();
          break;
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Re-fit when switching tabs
  useEffect(() => {
    requestAnimationFrame(() => {
      try {
        if (activeTab === "shell") {
          shellFitRef.current?.fit();
          shellTermRef.current?.focus();
        } else {
          runFitRef.current?.fit();
          runTermRef.current?.focus();
        }
      } catch {}
    });
  }, [activeTab]);

  // Panes on screen, two at most when split: on the Run tab, Run takes the second pane (the split
  // shell keeps running behind it and comes back on the shell tab).
  const showShells = activeTab === "shell" || splitOpen || runBeside;
  const showRun = activeTab === "run" || runBeside;
  const showSplitShell = splitOpen && !showRun;
  // What the split button does on this tab.
  // Anything shown beside the current pane counts as split; closing it closes all of it.
  const splitActive = splitOpen || runBeside;
  const toggleSplit = () => {
    if (splitActive) {
      setSplitOpen(false);
      setRunBeside(false);
    } else if (activeTab === "run") {
      setRunBeside(true);
    } else {
      setSplitOpen(true);
    }
  };

  /** The pane Clear and Kill act on: the last one focused, if it is still on screen. */
  const targetPane = (): "main" | "split" | "run" => {
    const pane = focusedPaneRef.current;
    if (pane === "run" && showRun) return "run";
    if (pane === "split" && showSplitShell && splitPaneRef.current) return "split";
    if (pane === "main" && showShells) return "main";
    return showRun ? "run" : "main";
  };

  // Screen only, like VS Code: clear() keeps the prompt line, and nothing is sent to the
  // shell (Enter would run a half-typed command, Ctrl+L would reach a program reading input).
  const handleClear = () => {
    const pane = targetPane();
    const term =
      pane === "run" ? runTermRef.current : pane === "split" ? splitPaneRef.current?.term : shellTermRef.current;
    term?.clear();
    term?.focus();
  };

  const handleStopRun = async () => {
    if (activeRunId) {
      await processService.stopRun(activeRunId).catch(() => {});
    }
  };

  // Trash, as in VS Code: ends a terminal rather than clearing it.
  const handleKill = () => {
    const pane = targetPane();
    if (pane === "run") {
      if (runActive) handleStopRun();
      // Unbind first: the stopped run's late "[Stopped by you]" line and any keys typed
      // now must not land in the emptied pane.
      runUnlistenRef.current.output?.();
      runUnlistenRef.current.status?.();
      runUnlistenRef.current.data?.();
      runUnlistenRef.current = {};
      setRunActive(false);
      runTermRef.current?.reset();
      runTermRef.current?.writeln(RUN_BANNER);
      setRunFileName(null);
      setActiveTab("shell");
      setRunBeside(false);
      focusedPaneRef.current = "main";
    } else if (pane === "split") {
      setSplitOpen(false);
      focusedPaneRef.current = "main";
    } else {
      // The main shell cannot go away, so killing it starts a fresh one.
      handleRestartShell();
    }
  };

  const restartingRef = useRef(false);
  const handleRestartShell = async () => {
    shellExitedRef.current = false;
    const term = shellTermRef.current;
    // One at a time: a double click would otherwise start two shells into one pane.
    if (!term || restartingRef.current) return;
    restartingRef.current = true;
    try {
      const oldId = sessionRef.current;
      if (shellUnlistenRef.current.data) shellUnlistenRef.current.data();
      if (shellUnlistenRef.current.exit) shellUnlistenRef.current.exit();
      shellUnlistenRef.current = {};
      if (oldId) await ptyService.killPty(oldId).catch(() => {});

      term.reset();
      term.writeln("\x1b[90m[Spawning new terminal shell...]\x1b[0m\r\n");

      const newId = "pty-" + Math.random().toString(36).substring(2, 10);
      sessionRef.current = newId;
      const unData = await ptyService.onPtyData(newId, (chunk) => term.write(chunk));
      const unExit = await ptyService.onPtyExit(newId, () => {
        shellExitedRef.current = true;
        term.writeln("\r\n\x1b[33m[Shell process exited. Press any key to start a new shell.]\x1b[0m");
      });
      shellUnlistenRef.current = { data: unData, exit: unExit };

      try {
        shellFitRef.current?.fit();
      } catch {}
      await ptyService.spawnPty({
        sessionId: newId,
        cols: Math.max(term.cols || 80, 20),
        rows: Math.max(term.rows || 24, 4),
        cwd: workspacePath,
      });
      onSessionReplaced?.(newId);
      term.focus();
    } catch (err) {
      // Next keystroke tries again (see onData).
      sessionRef.current = null;
      term.writeln(`\x1b[31m[Could not start a shell: ${err}. Press any key to retry.]\x1b[0m`);
    } finally {
      restartingRef.current = false;
    }
  };

  restartShellRef.current = handleRestartShell;

  return (
    <div className="terminal-panel-wrapper">
      {/* Terminal Toolbar */}
      <div className="terminal-panel-toolbar">
        <div className="terminal-toolbar-left">
          <button
            type="button"
            className={`terminal-tab-pill ${activeTab === "shell" ? "active" : ""}`}
            onClick={() => setActiveTab("shell")}
            title="Interactive Shell Session"
          >
            <TerminalIcon size={12} color={activeTab === "shell" ? "var(--accent-blue)" : "var(--text-muted)"} />
            <span>1: {shellName}</span>
          </button>

          <button
            type="button"
            className={`terminal-tab-pill ${activeTab === "run" ? "active" : ""}`}
            onClick={() => setActiveTab("run")}
            title="Dedicated Run Output and Interactive Stdin"
          >
            <Play size={12} color={runActive ? "var(--accent-green)" : activeTab === "run" ? "var(--accent-blue)" : "var(--text-muted)"} />
            <span>Run{runFileName ? `: ${runFileName}` : ""}</span>
            {runActive && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "var(--accent-green)",
                  display: "inline-block",
                }}
              />
            )}
          </button>
        </div>

        <div className="terminal-toolbar-right">
          {runActive && (
            <button
              className="icon-btn"
              title="Stop Running Program (Ctrl+C)"
              onClick={handleStopRun}
              style={{ color: "var(--accent-red)" }}
            >
              <Square size={13} fill="var(--accent-red)" />
            </button>
          )}

          {activeTab === "shell" && (
            <button
              className="icon-btn"
              title="New / Restart Shell"
              onClick={handleRestartShell}
            >
              <Plus size={13} />
            </button>
          )}

          {/* Also on the Run tab: the split is shown there too. */}
          <button
            className="icon-btn"
            title={splitActive ? "Close Split Terminal" : "Split Terminal"}
            aria-label={splitActive ? "Close Split Terminal" : "Split Terminal"}
            onClick={toggleSplit}
          >
            {splitActive ? <X size={13} /> : stacked ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </button>

          <button className="icon-btn" title="Clear Terminal" onClick={handleClear}>
            <Eraser size={13} />
          </button>

          <button className="icon-btn" title="Kill Terminal" onClick={handleKill}>
            <Trash2 size={13} />
          </button>

          {activeTab === "shell" && (
            <button
              className="icon-btn"
              title="Restart Terminal"
              onClick={handleRestartShell}
            >
              <RotateCw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Panes side by side: main shell, split shell, Run. The split stays on screen during a run. */}
      <div className={`terminal-row ${stacked ? "stacked" : ""}`}>
        <div
          className="terminal-xterm-viewport"
          ref={shellContainerRef}
          style={{ display: showShells ? "block" : "none" }}
          onMouseDown={() => shellTermRef.current?.focus()}
          onClick={() => shellTermRef.current?.focus()}
          onFocus={() => (focusedPaneRef.current = "main")}
        />
        {splitOpen && (
          <SplitShell
            cwd={workspacePath}
            paneRef={splitPaneRef}
            onFocus={() => (focusedPaneRef.current = "split")}
            onExit={() => setSplitOpen(false)}
            hidden={!showSplitShell}
          />
        )}
        <div
          className={`terminal-xterm-viewport ${showShells ? "terminal-split-pane" : ""}`}
          ref={runContainerRef}
          data-testid="run-terminal"
          style={{ display: showRun ? "block" : "none" }}
          onMouseDown={() => runTermRef.current?.focus()}
          onClick={() => runTermRef.current?.focus()}
          onFocus={() => (focusedPaneRef.current = "run")}
        />
      </div>
    </div>
  );
};
