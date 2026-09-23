import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptyService } from "../../services/ptyService";
import { Trash2, RotateCw, Terminal as TerminalIcon, Plus } from "lucide-react";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(sessionId);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(sessionId);
  const [shellName, setShellName] = useState<string>("powershell");
  const unlistenRef = useRef<{ data?: () => void; exit?: () => void }>({});

  sessionRef.current = activeSessionId;

  // React to external sessionId prop updates without creating duplicate listeners
  useEffect(() => {
    if (!sessionId || sessionId === sessionRef.current) return;
    let cancelled = false;

    const bindNewSession = async () => {
      if (unlistenRef.current.data) unlistenRef.current.data();
      if (unlistenRef.current.exit) unlistenRef.current.exit();
      unlistenRef.current = {};

      sessionRef.current = sessionId;
      setActiveSessionId(sessionId);

      const unData = await ptyService.onPtyData(sessionId, (chunk) => {
        if (!cancelled) termRef.current?.write(chunk);
      });
      const unExit = await ptyService.onPtyExit(sessionId, () => {
        if (!cancelled) termRef.current?.writeln("\r\n\x1b[33m[Process exited]\x1b[0m");
      });

      if (cancelled) {
        unData();
        unExit();
      } else {
        unlistenRef.current = { data: unData, exit: unExit };
      }
    };

    bindNewSession();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!containerRef.current) return;

    let isDisposed = false;

    // 1. Initialize xterm instance with blinking vertical bar cursor
    const term = new Terminal({
      theme: {
        background: "#181818",
        foreground: "#cccccc",
        cursor: "#528bff",
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
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
      fontFamily: "'JetBrains Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "block",
      cursorInactiveStyle: "outline",
      convertEol: true,
      scrollback: 5000,
      allowTransparency: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Immediately focus so the cursor block blinks on mount
    term.focus();

    // Listen for custom focus events from Run button or workspace actions
    const handleFocusTerminal = () => {
      term.focus();
    };
    window.addEventListener("focus-terminal", handleFocusTerminal);

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

    // 2. Keyboard typing -> Send to current active PTY session (NO local echo, PTY handles echo)
    term.onData((input) => {
      const current = sessionRef.current;
      if (current) {
        ptyService.writePty(current, input).catch((err) => {
          console.error("[TerminalPanel] writePty error:", err);
        });
      }
    });

    // 3. Start or bind to PTY session
    const setupSession = async () => {
      try {
        let sid = sessionRef.current || sessionId;
        if (!sid) {
          sid = "pty-" + Math.random().toString(36).substring(2, 10);
        }

        if (isDisposed) return;
        sessionRef.current = sid;
        setActiveSessionId(sid);

        // Subscribe to output first BEFORE spawning so zero output is dropped
        const unData = await ptyService.onPtyData(sid, (chunk) => {
          if (!isDisposed) {
            term.write(chunk);
          }
        });

        const unExit = await ptyService.onPtyExit(sid, () => {
          if (!isDisposed) {
            term.writeln("\r\n\x1b[33m[Process exited]\x1b[0m");
          }
        });

        if (isDisposed) {
          unData();
          unExit();
          return;
        }

        unlistenRef.current = { data: unData, exit: unExit };

        // Spawn PTY session with pre-registered sid
        const cols = Math.max(term.cols || 80, 20);
        const rows = Math.max(term.rows || 24, 4);
        if (onEnsureSession) {
          await onEnsureSession(sid);
        } else {
          await ptyService.spawnPty({
            sessionId: sid,
            cols,
            rows,
            cwd: workspacePath,
          });
        }

        // Fit & initial size sync & focus
        setTimeout(() => {
          if (isDisposed || !containerRef.current) return;
          try {
            fitAddon.fit();
            const safeCols = Math.max(term.cols || 80, 20);
            const safeRows = Math.max(term.rows || 24, 4);
            ptyService.resizePty(sid, safeCols, safeRows);
            term.focus();
          } catch {}
        }, 60);
      } catch (err) {
        console.error("[TerminalPanel] Failed to setup session:", err);
        if (!isDisposed) {
          term.writeln(`\r\n\x1b[31m[Failed to open terminal: ${err}]\x1b[0m\r\n`);
        }
      }
    };

    setupSession();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (isDisposed || !containerRef.current) return;
      try {
        fitAddon.fit();
        const sid = sessionRef.current;
        if (sid && term.cols > 0 && term.rows > 0) {
          ptyService.resizePty(sid, Math.max(term.cols, 20), Math.max(term.rows, 4));
        }
      } catch {}
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      isDisposed = true;
      window.removeEventListener("focus-terminal", handleFocusTerminal);
      resizeObserver.disconnect();
      if (unlistenRef.current.data) unlistenRef.current.data();
      if (unlistenRef.current.exit) unlistenRef.current.exit();
      unlistenRef.current = {};
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
      const sid = sessionRef.current;
      if (sid) {
        ptyService.writePty(sid, "\r");
      }
    }
  };

  const handleRestart = async () => {
    const oldId = sessionRef.current;
    if (oldId) {
      if (unlistenRef.current.data) unlistenRef.current.data();
      if (unlistenRef.current.exit) unlistenRef.current.exit();
      unlistenRef.current = {};
      await ptyService.killPty(oldId);
    }

    if (termRef.current && fitAddonRef.current) {
      termRef.current.clear();
      termRef.current.writeln("\x1b[90m[Spawning new terminal shell...]\x1b[0m\r\n");

      const newId = "pty-" + Math.random().toString(36).substring(2, 10);
      sessionRef.current = newId;
      setActiveSessionId(newId);

      // Listen first
      const unData = await ptyService.onPtyData(newId, (chunk) => {
        termRef.current?.write(chunk);
      });
      const unExit = await ptyService.onPtyExit(newId, () => {
        termRef.current?.writeln("\r\n\x1b[33m[Process exited]\x1b[0m");
      });
      unlistenRef.current = { data: unData, exit: unExit };

      // Spawn
      const cols = Math.max(termRef.current.cols || 80, 20);
      const rows = Math.max(termRef.current.rows || 24, 4);
      await ptyService.spawnPty({
        sessionId: newId,
        cols,
        rows,
        cwd: workspacePath,
      });

      setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          ptyService.resizePty(
            newId,
            Math.max(termRef.current?.cols || 80, 20),
            Math.max(termRef.current?.rows || 24, 4)
          );
          termRef.current?.focus();
          ptyService.writePty(newId, "\r");
        } catch {}
      }, 150);
    }
  };

  return (
    <div className="terminal-panel-wrapper">
      {/* Terminal Toolbar */}
      <div className="terminal-panel-toolbar">
        <div className="terminal-toolbar-left">
          <div className="terminal-tab-pill">
            <TerminalIcon size={12} color="#007acc" />
            <span>1: {shellName}</span>
          </div>
        </div>

        <div className="terminal-toolbar-right">
          <button
            className="icon-btn"
            title="New Terminal"
            onClick={handleRestart}
          >
            <Plus size={13} />
          </button>
          <button
            className="icon-btn"
            title="Clear Terminal"
            onClick={handleClear}
          >
            <Trash2 size={13} />
          </button>
          <button
            className="icon-btn"
            title="Restart Terminal"
            onClick={handleRestart}
          >
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      {/* Xterm Render Target */}
      <div
        className="terminal-xterm-viewport"
        ref={containerRef}
        onMouseDown={() => termRef.current?.focus()}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
};
