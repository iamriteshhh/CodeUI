// ptyService.ts: Cross-platform PTY service for Tauri desktop & web-dev mode
import { fsService } from "./fsService";
import { invoke, isTauri as isTauriCore } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const isTauri = () => {
  if (typeof window === "undefined") return false;
  try {
    return isTauriCore() || "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  } catch {
    return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
  }
};

interface MockSession {
  id: string;
  cwd: string;
  lineBuffer: string;
  history: string[];
  historyIndex: number;
  lastSource?: string;
}

// In-memory fallback sessions for testing outside Tauri webview
const mockSessions = new Map<string, MockSession>();

interface SessionListeners {
  dataCallbacks: Set<(data: string) => void>;
  tauriDataUnlisten?: () => void;
  exitCallbacks: Set<() => void>;
  tauriExitUnlisten?: () => void;
}

const sessionRegistry = new Map<string, SessionListeners>();

function getSessionEntry(sessionId: string): SessionListeners {
  let entry = sessionRegistry.get(sessionId);
  if (!entry) {
    entry = {
      dataCallbacks: new Set(),
      exitCallbacks: new Set(),
    };
    sessionRegistry.set(sessionId, entry);
  }
  return entry;
}

export const ptyService = {
  async spawnPty(options?: {
    sessionId?: string;
    cols?: number;
    rows?: number;
    shell?: string;
    cwd?: string;
  }): Promise<string> {
    if (isTauri()) {
      return await invoke<string>("spawn_pty", {
        sessionId: options?.sessionId,
        cols: options?.cols,
        rows: options?.rows,
        shell: options?.shell,
        cwd: options?.cwd,
      });
    }

    // Interactive mock terminal session for browser testing
    const mockId = options?.sessionId || "pty-" + Math.random().toString(36).substring(2, 9);
    const session: MockSession = {
      id: mockId,
      cwd: options?.cwd || "D:\\JAVA",
      lineBuffer: "",
      history: [],
      historyIndex: -1,
    };
    mockSessions.set(mockId, session);

    setTimeout(() => {
      this.triggerMockData(
        mockId,
        `\x1b[36mWindows PowerShell\x1b[0m\r\nCopyright (C) Microsoft Corporation. All rights reserved.\r\n\r\nPS ${session.cwd}> `
      );
    }, 50);

    return mockId;
  },

  async writePty(sessionId: string, data: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>("write_pty", { sessionId, data });
    }

    let session = mockSessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        cwd: "D:\\JAVA",
        lineBuffer: "",
        history: [],
        historyIndex: -1,
      };
      mockSessions.set(sessionId, session);
    }

    // 1. Enter key: Execute line buffer or passed full command
    if (data === "\r" || data === "\n" || (data.includes("\r") || data.includes("\n"))) {
      let commandToRun = "";
      if (data.length > 2 && (data.includes("\r") || data.includes("\n"))) {
        // Full command passed directly (e.g. from runActiveFile)
        commandToRun = data.replace(/[\r\n]/g, "").trim();
        this.triggerMockData(sessionId, commandToRun + "\r\n");
      } else {
        // User typed command in terminal and pressed Enter
        commandToRun = session.lineBuffer.trim();
        this.triggerMockData(sessionId, "\r\n");
      }

      session.lineBuffer = "";
      session.historyIndex = -1;

      if (commandToRun) {
        session.history.push(commandToRun);
        await this.executeMockCommand(session, commandToRun);
      }

      this.triggerMockData(sessionId, `PS ${session.cwd}> `);
      return;
    }

    // 2. Backspace
    if (data === "\x7f" || data === "\b") {
      if (session.lineBuffer.length > 0) {
        session.lineBuffer = session.lineBuffer.slice(0, -1);
        this.triggerMockData(sessionId, "\b \b");
      }
      return;
    }

    // 3. Ctrl+C (Interrupt)
    if (data === "\x03") {
      session.lineBuffer = "";
      this.triggerMockData(sessionId, `^C\r\nPS ${session.cwd}> `);
      return;
    }

    // 4. Up Arrow (History Backwards)
    if (data === "\x1b[A") {
      if (session.history.length > 0) {
        if (session.historyIndex === -1) {
          session.historyIndex = session.history.length - 1;
        } else if (session.historyIndex > 0) {
          session.historyIndex--;
        }
        const histCmd = session.history[session.historyIndex] || "";
        const erase = "\b \b".repeat(session.lineBuffer.length);
        session.lineBuffer = histCmd;
        this.triggerMockData(sessionId, erase + histCmd);
      }
      return;
    }

    // 5. Down Arrow (History Forwards)
    if (data === "\x1b[B") {
      if (session.historyIndex !== -1) {
        if (session.historyIndex < session.history.length - 1) {
          session.historyIndex++;
          const histCmd = session.history[session.historyIndex];
          const erase = "\b \b".repeat(session.lineBuffer.length);
          session.lineBuffer = histCmd;
          this.triggerMockData(sessionId, erase + histCmd);
        } else {
          session.historyIndex = -1;
          const erase = "\b \b".repeat(session.lineBuffer.length);
          session.lineBuffer = "";
          this.triggerMockData(sessionId, erase);
        }
      }
      return;
    }

    // 6. Tab Key: Autocomplete files in cwd
    if (data === "\t") {
      const parts = session.lineBuffer.split(" ");
      const lastToken = parts[parts.length - 1];
      if (lastToken) {
        try {
          const files = await fsService.listDir(session.cwd);
          const match = files.find((f) => f.name.toLowerCase().startsWith(lastToken.toLowerCase()));
          if (match) {
            const added = match.name.slice(lastToken.length);
            session.lineBuffer += added;
            this.triggerMockData(sessionId, added);
          }
        } catch {}
      }
      return;
    }

    // 7. Normal typed printable characters
    session.lineBuffer += data;
    this.triggerMockData(sessionId, data);
  },

  async executeMockCommand(session: MockSession, fullCommand: string): Promise<void> {
    // Handle command chaining: e.g. cd "dir"; javac "p1.java"; if ($?) { java "p1" }
    const subCommands = fullCommand
      .split(/;|&&/)
      .map((c) => c.trim())
      .filter(Boolean);

    for (const raw of subCommands) {
      // Clean command: remove "if ($?)" guards and surrounding quotes
      let cmd = raw.replace(/^if\s*\(\$\?\)\s*\{\s*/, "").replace(/\s*\}$/, "").trim();
      if (!cmd) continue;

      if (cmd.startsWith("cd ") || cmd.startsWith("cd\t")) {
        const target = cmd.slice(3).trim().replace(/^["']|["']$/g, "");
        if (target === ".." || target === "../") {
          const parts = session.cwd.split(/[/\\]/).filter(Boolean);
          if (parts.length > 1) parts.pop();
          session.cwd = parts.join("\\");
        } else if (target) {
          session.cwd = target;
        }
        continue;
      }

      if (cmd === "clear" || cmd === "cls") {
        this.triggerMockData(session.id, "\x1b[2J\x1b[H");
        continue;
      }

      if (cmd === "pwd") {
        this.triggerMockData(session.id, session.cwd + "\r\n");
        continue;
      }

      if (cmd.startsWith("echo ")) {
        const text = cmd.slice(5).replace(/^["']|["']$/g, "");
        this.triggerMockData(session.id, text + "\r\n");
        continue;
      }

      if (cmd === "dir" || cmd === "ls") {
        try {
          const entries = await fsService.listDir(session.cwd);
          let out = `\r\n    Directory: ${session.cwd}\r\n\r\n`;
          out += `Mode                 LastWriteTime         Length Name\r\n`;
          out += `----                 -------------         ------ ----\r\n`;
          for (const e of entries) {
            const dateStr = "9/20/2026   9:20 PM";
            const lenStr = e.size.toString().padStart(14, " ");
            const mode = e.is_dir ? "d----" : "-a---";
            out += `${mode}          ${dateStr} ${lenStr} ${e.name}\r\n`;
          }
          out += "\r\n";
          this.triggerMockData(session.id, out);
        } catch (err) {
          this.triggerMockData(session.id, `Cannot access directory: ${err}\r\n`);
        }
        continue;
      }

      if (cmd.startsWith("cat ") || cmd.startsWith("type ") || cmd.startsWith("Get-Content ")) {
        const filePart = cmd.replace(/^(cat|type|Get-Content)\s+/, "").trim().replace(/^["']|["']$/g, "");
        const filePath = filePart.includes(":") || filePart.startsWith("/") ? filePart : `${session.cwd}\\${filePart}`;
        try {
          const content = await fsService.readFile(filePath);
          this.triggerMockData(session.id, content.replace(/\r?\n/g, "\r\n") + "\r\n");
        } catch {
          this.triggerMockData(session.id, `cat: ${filePart}: No such file or directory\r\n`);
        }
        continue;
      }

      // Python runners
      if (cmd.startsWith("python ") || cmd.startsWith("python3 ") || cmd.startsWith("py ")) {
        const cleanArgs = cmd.replace(/^(python3?|py)\s+(-u\s+)?/, "").trim().replace(/^["']|["']$/g, "");
        const filePath = cleanArgs.includes(":") ? cleanArgs : `${session.cwd}\\${cleanArgs}`;
        try {
          const content = await fsService.readFile(filePath);
          // Look for print statements to simulate real output
          const prints = content.match(/print\((["'`])(.*?)\1\)/g);
          if (prints && prints.length > 0) {
            for (const p of prints) {
              const matchedText = p.replace(/^print\((["'`])/, "").replace(/(["'`])\)$/, "");
              this.triggerMockData(session.id, matchedText + "\r\n");
            }
          } else {
            this.triggerMockData(session.id, "Hello from Python 3!\r\nWelcome, User!\r\n");
          }
        } catch {
          this.triggerMockData(session.id, `Hello from Python 3!\r\nProgram executed successfully.\r\n`);
        }
        continue;
      }

      // Java compiler
      if (cmd.startsWith("javac ")) {
        this.triggerMockData(session.id, "\x1b[36m[javac]\x1b[0m Compiled source files in 138ms (0 warnings).\r\n");
        continue;
      }

      // Java runtime
      if (cmd.startsWith("java ") || cmd.startsWith("& java ")) {
        const classTarget = cmd.replace(/^(&\s*)?java\s+/, "").trim().replace(/^["']|["']$/g, "");
        if (classTarget.includes("p1") || classTarget.includes("Main")) {
          this.triggerMockData(session.id, "Hello CodeUI!\r\n");
        } else if (classTarget.includes("p2") || classTarget.includes("CheckDivisibility")) {
          this.triggerMockData(session.id, "Enter the number: 55\r\nThe number is divisible by both 5 and 11\r\n");
        } else {
          this.triggerMockData(session.id, `[java] Program ${classTarget} completed successfully.\r\n`);
        }
        continue;
      }

      // Salivo toolchain
      if (cmd === "sf" || cmd.startsWith("sf ") || cmd === "sf.exe" || cmd.startsWith("sf.exe ")) {
        const arg = cmd.replace(/^sf(\.exe)?/, "").trim();
        if (!arg || arg === "--help" || arg === "-h" || arg === "help") {
          this.triggerMockData(
            session.id,
            `Salivo Compiler Driver\r\n\r\nUsage: sf.exe <COMMAND>\r\n\r\nCommands:\r\n  build      Build a Salivo source file into a native executable\r\n  run        Build and immediately run the resulting executable\r\n  check      Check syntax and semantics without codegen\r\n  version    Print compiler version\r\n`
          );
          continue;
        }

        if (arg === "-V" || arg === "--version" || arg === "version") {
          this.triggerMockData(session.id, "salivo 0.1.0\r\n");
          continue;
        }

        if (arg.startsWith("run ") || arg.startsWith("build ")) {
          const filePart = arg.replace(/^(run|build)\s+/, "").trim().replace(/^["']|["']$/g, "");
          const filePath = filePart.includes(":") || filePart.startsWith("/") ? filePart : `${session.cwd}\\${filePart}`;
          this.triggerMockData(session.id, "\x1b[36m[salivo]\x1b[0m Compiled in 42ms\r\n");
          try {
            const content = await fsService.readFile(filePath);
            const outlnMatches = content.match(/outln\(\s*(\$?"(?:[^"\\]|\\.)*")\s*\)/g);
            if (outlnMatches && outlnMatches.length > 0) {
              for (const m of outlnMatches) {
                const str = m.replace(/^outln\(\s*\$?"/, "").replace(/"\s*\)$/, "").replace(/\\n/g, "");
                this.triggerMockData(session.id, str + "\r\n");
              }
            } else {
              this.triggerMockData(session.id, "Hello from Salivo! Stream pipeline >< active.\r\n");
            }
          } catch {
            this.triggerMockData(session.id, "Hello from Salivo! Stream pipeline >< active.\r\n");
          }
          continue;
        }

        this.triggerMockData(
          session.id,
          `\x1b[36m[salivo]\x1b[0m Compiled in 42ms\r\nHello from Salivo! Stream pipeline >< active.\r\n`
        );
        continue;
      }

      // C compiler (gcc / clang)
      if (cmd.startsWith("gcc ") || cmd === "gcc" || cmd.startsWith("clang ") || cmd === "clang") {
        const arg = cmd.replace(/^(gcc|clang)\s*/, "").trim();
        if (arg === "--version" || arg === "-v") {
          this.triggerMockData(session.id, "gcc.exe (MinGW.org GCC-6.3.0-1) 6.3.0\r\n");
          continue;
        }
        const srcMatch = cmd.match(/["']?([^"'\s]+\.c)["']?/);
        if (srcMatch) {
          session.lastSource = srcMatch[1];
        }
        continue;
      }

      // C++ compiler (g++ / clang++)
      if (cmd.startsWith("g++ ") || cmd === "g++" || cmd.startsWith("clang++ ") || cmd === "clang++") {
        const arg = cmd.replace(/^(g\+\+|clang\+\+)\s*/, "").trim();
        if (arg === "--version" || arg === "-v") {
          this.triggerMockData(session.id, "g++.exe (MinGW.org GCC-6.3.0-1) 6.3.0\r\n");
          continue;
        }
        const srcMatch = cmd.match(/["']?([^"'\s]+\.cpp)["']?/);
        if (srcMatch) {
          session.lastSource = srcMatch[1];
        }
        continue;
      }

      // Execution of compiled native binary
      if (cmd.startsWith(".\\") || cmd.startsWith("./") || cmd.endsWith(".exe")) {
        const sourceFile = session.lastSource;
        let outputPrinted = false;
        if (sourceFile) {
          const filePath = sourceFile.includes(":") || sourceFile.startsWith("/") ? sourceFile : `${session.cwd}\\${sourceFile}`;
          try {
            const content = await fsService.readFile(filePath);
            const printfs = content.match(/(?:printf|puts)\(\s*"([^"]*)"\s*\)/g);
            if (printfs && printfs.length > 0) {
              for (const p of printfs) {
                const text = p.replace(/^(?:printf|puts)\(\s*"/, "").replace(/"\s*\)$/, "").replace(/\\n/g, "");
                this.triggerMockData(session.id, text + "\r\n");
                outputPrinted = true;
              }
            }
            const couts = content.match(/(?:std::)?cout\s*<<\s*"([^"]*)"/g);
            if (couts && couts.length > 0) {
              for (const c of couts) {
                const text = c.replace(/^(?:std::)?cout\s*<<\s*"/, "").replace(/"$/, "").replace(/\\n/g, "");
                this.triggerMockData(session.id, text + "\r\n");
                outputPrinted = true;
              }
            }
          } catch {}
        }
        if (!outputPrinted) {
          this.triggerMockData(session.id, "Program executed successfully with exit code 0.\r\n");
        }
        continue;
      }

      // Node runner
      if (cmd.startsWith("node ")) {
        const arg = cmd.replace(/^node\s+/, "").trim();
        if (arg === "-v" || arg === "--version") {
          this.triggerMockData(session.id, "v20.11.1\r\n");
        } else {
          this.triggerMockData(session.id, `[node] execution finished for ${arg}\r\n`);
        }
        continue;
      }

      if (cmd === "help") {
        this.triggerMockData(
          session.id,
          `\r\nCodeUI Integrated Terminal Shell\r\nSupported commands: dir, ls, cd, pwd, cat, type, echo, clear, cls, python, java, javac, sf, gcc, g++, node, help\r\n\r\n`
        );
        continue;
      }

      // Default unrecognized command message
      this.triggerMockData(
        session.id,
        `${cmd}: The term '${cmd}' is not recognized as a command.\r\nType 'help' for available commands.\r\n`
      );
    }
  },

  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    if (isTauri()) {
      const safeCols = Math.max(cols || 80, 20);
      const safeRows = Math.max(rows || 24, 4);
      return await invoke<void>("resize_pty", { sessionId, cols: safeCols, rows: safeRows });
    }
  },

  async killPty(sessionId: string): Promise<void> {
    if (isTauri()) {
      return await invoke<void>("kill_pty", { sessionId });
    }
    mockSessions.delete(sessionId);
    sessionRegistry.delete(sessionId);
  },

  async listPtySessions(): Promise<string[]> {
    if (isTauri()) {
      return await invoke<string[]>("list_pty_sessions");
    }
    return Array.from(mockSessions.keys());
  },

  async getDefaultShell(): Promise<string> {
    if (isTauri()) {
      return await invoke<string>("get_default_shell");
    }
    return "powershell.exe";
  },

  async onPtyData(
    sessionId: string,
    callback: (data: string) => void
  ): Promise<() => void> {
    const entry = getSessionEntry(sessionId);
    entry.dataCallbacks.add(callback);

    if (isTauri() && !entry.tauriDataUnlisten) {
      try {
        entry.tauriDataUnlisten = await listen<any>(
          `pty-data-${sessionId}`,
          (e) => {
            let text = "";
            if (typeof e.payload === "string") {
              text = e.payload;
            } else if (e.payload && typeof e.payload.data === "string") {
              text = e.payload.data;
            }
            if (text) {
              entry.dataCallbacks.forEach((cb) => {
                try {
                  cb(text);
                } catch (err) {
                  console.error("[ptyService] callback error:", err);
                }
              });
            }
          }
        );
      } catch (err) {
        console.error(`[ptyService] Failed to listen on pty-data-${sessionId}:`, err);
      }
    }

    return () => {
      entry.dataCallbacks.delete(callback);
      if (entry.dataCallbacks.size === 0 && entry.tauriDataUnlisten) {
        entry.tauriDataUnlisten();
        delete entry.tauriDataUnlisten;
      }
      if (entry.dataCallbacks.size === 0 && entry.exitCallbacks.size === 0) {
        sessionRegistry.delete(sessionId);
      }
    };
  },

  async onPtyExit(sessionId: string, callback: () => void): Promise<() => void> {
    const entry = getSessionEntry(sessionId);
    entry.exitCallbacks.add(callback);

    if (isTauri() && !entry.tauriExitUnlisten) {
      try {
        entry.tauriExitUnlisten = await listen<any>(`pty-exit-${sessionId}`, () => {
          entry.exitCallbacks.forEach((cb) => {
            try {
              cb();
            } catch (err) {
              console.error("[ptyService] exit callback error:", err);
            }
          });
        });
      } catch (err) {
        console.error(`[ptyService] Failed to listen on pty-exit-${sessionId}:`, err);
      }
    }

    return () => {
      entry.exitCallbacks.delete(callback);
      if (entry.exitCallbacks.size === 0 && entry.tauriExitUnlisten) {
        entry.tauriExitUnlisten();
        delete entry.tauriExitUnlisten;
      }
      if (entry.dataCallbacks.size === 0 && entry.exitCallbacks.size === 0) {
        sessionRegistry.delete(sessionId);
      }
    };
  },

  triggerMockData(sessionId: string, data: string) {
    const entry = sessionRegistry.get(sessionId);
    if (entry) {
      entry.dataCallbacks.forEach((cb) => cb(data));
    }
  },
};

