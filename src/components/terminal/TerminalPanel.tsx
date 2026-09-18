import React, { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptyService } from "../../services/ptyService";
import { Trash2 } from "lucide-react";

interface TerminalPanelProps {
  sessionId: string | null;
  onEnsureSession: () => Promise<string>;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  sessionId,
  onEnsureSession,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Initialize xterm instance
    const term = new Terminal({
      theme: {
        background: "#1e1e1e",
        foreground: "#cccccc",
        cursor: "#007acc",
        selectionBackground: "rgba(0, 122, 204, 0.4)",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
      },
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    let activeSession = sessionId;
    let unlistenData: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const setupSession = async () => {
      if (!activeSession) {
        activeSession = await onEnsureSession();
      }
      if (!activeSession) return;

      // Handle user keyboard input -> PTY
      term.onData((data) => {
        if (activeSession) {
          ptyService.writePty(activeSession, data);
        }
      });

      // Handle PTY data stream -> xterm output
      unlistenData = await ptyService.onPtyData(activeSession, (data) => {
        term.write(data);
      });

      // Handle PTY exit event
      unlistenExit = await ptyService.onPtyExit(activeSession, () => {
        term.write("\r\n\x1b[33m[Process exited]\x1b[0m\r\n");
      });

      // Initial resize sync
      if (fitAddon) {
        fitAddon.fit();
        ptyService.resizePty(activeSession, term.cols, term.rows);
      }
    };

    setupSession();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        if (activeSession) {
          ptyService.resizePty(activeSession, term.cols, term.rows);
        }
      } catch {
        // ignore resize errors during unmount
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      term.dispose();
    };
  }, [sessionId, onEnsureSession]);

  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px",
          background: "#1e1e1e",
          borderBottom: "1px solid #2b2b2b",
        }}
      >
        <button
          className="icon-btn"
          title="Clear Terminal"
          onClick={handleClear}
          style={{ fontSize: 11, display: "flex", gap: 4 }}
        >
          <Trash2 size={12} />
          <span>Clear</span>
        </button>
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          padding: "4px 8px",
          overflow: "hidden",
        }}
      />
    </div>
  );
};
