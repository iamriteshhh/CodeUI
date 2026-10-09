import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptyService } from "../../services/ptyService";
import { processService } from "../../services/processService";
import { parseCompilerDiagnostics } from "../../services/diagnostics";
import { editorService } from "../../services/editorService";
import { markTerminalReady, WORKSPACE_RESET_EVENT } from "../../services/terminalReady";
import { Trash2, RotateCw, Terminal as TerminalIcon, Plus, Play, Square } from "lucide-react";

/** detail of the "codeui-run-start" event dispatched by runActiveFile. */
interface RunStartDetail {
  runId: string;
  name: string;
  language: string;
  path: string;
  /** Set here: the size the program's terminal starts with. */
  size?: { cols: number; rows: number };
}

interface TerminalPanelProps {
  sessionId: string | null;
  workspacePath?: string;
  onEnsureSession?: (preferredId?: string) => Promise<string>;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  sessionId,
  workspacePath,
  onEnsureSession,
}) => {
  const [activeTab, setActiveTab] = useState<"shell" | "run">("shell");
  const [shellName, setShellName] = useState<string>("terminal");
  const [runFileName, setRunFileName] = useState<string | null>(null);
  const [runActive, setRunActive] = useState<boolean>(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

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
  const shellUnlistenRef = useRef<{ data?: () => void; exit?: () => void }>({});
  const runUnlistenRef = useRef<{ output?: () => void; status?: () => void; data?: () => void }>({});

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
      shellTermRef.current?.writeln("\r\n\x1b[33m[Shell process exited]\x1b[0m");
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
    shellTermRef.current = shellTerm;
    shellFitRef.current = shellFit;

    shellTerm.onData((input) => {
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
    runTermRef.current = runTerm;
    runFitRef.current = runFit;

    runTerm.writeln("\x1b[90m[CodeUI Supervised Runner — press F5 or click Run to execute active file]\x1b[0m\r\n");

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
      const dataDisp = rTerm.onData((data) => {
        if (data === "\x03") {
          processService.stopRun(runId);
        } else if (data === "\x1a") {
          processService.closeRunStdin(runId);
        } else {
          processService.writeRunStdin(runId, data).catch((err) => {
            console.error("[Run Terminal] writeRunStdin error:", err);
          });
        }
      });

      let unOut: (() => void) | undefined;
      let unStat: (() => void) | undefined;
      let stderr = "";

      processService
        .onRunOutput(runId, (chunk) => {
          if (chunk.stream === "stderr") stderr += chunk.chunk;
          rTerm.write(chunk.chunk);
        })
        .then((un) => {
          unOut = un;
        });

      processService
        .onRunStatus(runId, (status) => {
          if (status.phase === "running") {
            rTerm.writeln(`\r\n\x1b[32m[Running ${name} (PID: ${status.pid})]\x1b[0m\r\n`);
          } else if (status.phase === "compileFailed") {
            rTerm.writeln(
              `\r\n\x1b[31m[Build failed (exit code ${status.exitCode ?? 1})]\x1b[0m\r\n`
            );
            const source = editorService.getText(path) ?? undefined;
            for (const d of parseCompilerDiagnostics(language, stderr, path, source)) {
              if (d.hint) rTerm.writeln(`\x1b[33m[Likely cause] ${d.hint}\x1b[0m\r\n`);
            }
            setRunActive(false);
          } else if (status.phase === "finished") {
            const dur = status.durationMs ?? 0;
            rTerm.writeln(
              `\r\n\x1b[90m[Process exited with code ${status.exitCode ?? 0} in ${dur}ms]\x1b[0m\r\n`
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

    const handleFocusTerminal = () => {
      if (activeTab === "run") {
        runTermRef.current?.focus();
      } else {
        shellTermRef.current?.focus();
      }
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
      shellTerm.reset();
      shellTerm.writeln("\x1b[90m[Folder changed. Press any key to start a new shell.]\x1b[0m");
      runTerm.reset();
      runTerm.writeln("\x1b[90m[CodeUI Supervised Runner — press F5 or click Run to execute active file]\x1b[0m\r\n");
    };

    window.addEventListener("codeui-run-start", handleRunStart);
    window.addEventListener(WORKSPACE_RESET_EVENT, handleWorkspaceReset);
    markTerminalReady();
    window.addEventListener("focus-terminal", handleFocusTerminal);

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
      window.removeEventListener("focus-terminal", handleFocusTerminal);
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

  const handleClear = () => {
    if (activeTab === "shell" && shellTermRef.current) {
      shellTermRef.current.clear();
      const sid = sessionRef.current;
      if (sid) ptyService.writePty(sid, "\r");
    } else if (activeTab === "run" && runTermRef.current) {
      runTermRef.current.clear();
    }
  };

  const handleStopRun = async () => {
    if (activeRunId) {
      await processService.stopRun(activeRunId);
    }
  };

  const handleRestartShell = async () => {
    const oldId = sessionRef.current;
    if (oldId) {
      if (shellUnlistenRef.current.data) shellUnlistenRef.current.data();
      if (shellUnlistenRef.current.exit) shellUnlistenRef.current.exit();
      shellUnlistenRef.current = {};
      await ptyService.killPty(oldId);
    }

    if (shellTermRef.current && shellFitRef.current) {
      shellTermRef.current.clear();
      shellTermRef.current.writeln("\x1b[90m[Spawning new terminal shell...]\x1b[0m\r\n");

      const newId = "pty-" + Math.random().toString(36).substring(2, 10);
      sessionRef.current = newId;

      const unData = await ptyService.onPtyData(newId, (chunk) => {
        shellTermRef.current?.write(chunk);
      });
      const unExit = await ptyService.onPtyExit(newId, () => {
        shellTermRef.current?.writeln("\r\n\x1b[33m[Shell process exited]\x1b[0m");
      });
      shellUnlistenRef.current = { data: unData, exit: unExit };

      const cols = Math.max(shellTermRef.current.cols || 80, 20);
      const rows = Math.max(shellTermRef.current.rows || 24, 4);
      await ptyService.spawnPty({
        sessionId: newId,
        cols,
        rows,
        cwd: workspacePath,
      });

      requestAnimationFrame(() => {
        try {
          shellFitRef.current?.fit();
          ptyService.resizePty(
            newId,
            Math.max(shellTermRef.current?.cols || 80, 20),
            Math.max(shellTermRef.current?.rows || 24, 4)
          );
          shellTermRef.current?.focus();
          ptyService.writePty(newId, "\r");
        } catch {}
      });
    }
  };

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

          <button
            className="icon-btn"
            title="Clear Terminal"
            onClick={handleClear}
          >
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

      {/* Shell Terminal Viewport */}
      <div
        className="terminal-xterm-viewport"
        ref={shellContainerRef}
        style={{ display: activeTab === "shell" ? "block" : "none" }}
        onMouseDown={() => shellTermRef.current?.focus()}
        onClick={() => shellTermRef.current?.focus()}
      />

      {/* Run Terminal Viewport */}
      <div
        className="terminal-xterm-viewport"
        ref={runContainerRef}
        style={{ display: activeTab === "run" ? "block" : "none" }}
        onMouseDown={() => runTermRef.current?.focus()}
        onClick={() => runTermRef.current?.focus()}
      />
    </div>
  );
};
