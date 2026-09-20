// ptyService.ts

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getInvoke() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  return null;
}

async function getEvent() {
  if (isTauri()) {
    return await import("@tauri-apps/api/event");
  }
  return null;
}

// Fallback handlers for standalone mock mode
const mockDataListeners = new Map<string, ((data: string) => void)[]>();
const mockExitListeners = new Map<string, (() => void)[]>();

export const ptyService = {
  async spawnPty(options?: {
    sessionId?: string;
    cols?: number;
    rows?: number;
    shell?: string;
    cwd?: string;
  }): Promise<string> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string>("spawn_pty", {
        sessionId: options?.sessionId,
        cols: options?.cols,
        rows: options?.rows,
        shell: options?.shell,
        cwd: options?.cwd,
      });
    }

    // Mock terminal session for standalone browser development
    const mockId = "mock-pty-" + Math.random().toString(36).substring(2, 9);
    setTimeout(() => {
      this.triggerMockData(
        mockId,
        "\r\n\x1b[36mCodeUI Terminal Shell\x1b[0m\r\nType commands or use Run/Debug to execute programs.\r\n$ "
      );
    }, 100);
    return mockId;
  },

  async writePty(sessionId: string, data: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("write_pty", { sessionId, data });
    }

    // Echo in mock terminal
    if (data === "\r") {
      this.triggerMockData(sessionId, "\r\n$ ");
    } else if (data === "\x7f" || data === "\b") {
      this.triggerMockData(sessionId, "\b \b");
    } else {
      this.triggerMockData(sessionId, data);
    }
  },

  async resizePty(sessionId: string, cols: number, rows: number): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      const safeCols = Math.max(cols || 80, 10);
      const safeRows = Math.max(rows || 24, 4);
      return await invoke<void>("resize_pty", { sessionId, cols: safeCols, rows: safeRows });
    }
  },

  async killPty(sessionId: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("kill_pty", { sessionId });
    }
    mockDataListeners.delete(sessionId);
    mockExitListeners.delete(sessionId);
  },

  async listPtySessions(): Promise<string[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string[]>("list_pty_sessions");
    }
    return Array.from(mockDataListeners.keys());
  },

  async getDefaultShell(): Promise<string> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string>("get_default_shell");
    }
    return "powershell.exe";
  },

  async onPtyData(
    sessionId: string,
    callback: (data: string) => void
  ): Promise<() => void> {
    const event = await getEvent();
    if (event) {
      try {
        const unlisten = await event.listen<any>(
          `pty-data-${sessionId}`,
          (e) => {
            let text = "";
            if (typeof e.payload === "string") {
              text = e.payload;
            } else if (e.payload && typeof e.payload.data === "string") {
              text = e.payload.data;
            }
            if (text) {
              callback(text);
            }
          }
        );
        return unlisten;
      } catch (err) {
        console.error(`[ptyService] Failed to listen on pty-data-${sessionId}:`, err);
      }
    }

    // Mock listener
    if (!mockDataListeners.has(sessionId)) {
      mockDataListeners.set(sessionId, []);
    }
    mockDataListeners.get(sessionId)!.push(callback);
    return () => {
      const list = mockDataListeners.get(sessionId) || [];
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  },

  async onPtyExit(sessionId: string, callback: () => void): Promise<() => void> {
    const event = await getEvent();
    if (event) {
      try {
        const unlisten = await event.listen<any>(`pty-exit-${sessionId}`, () => {
          callback();
        });
        return unlisten;
      } catch (err) {
        console.error(`[ptyService] Failed to listen on pty-exit-${sessionId}:`, err);
      }
    }

    if (!mockExitListeners.has(sessionId)) {
      mockExitListeners.set(sessionId, []);
    }
    mockExitListeners.get(sessionId)!.push(callback);
    return () => {
      const list = mockExitListeners.get(sessionId) || [];
      const idx = list.indexOf(callback);
      if (idx !== -1) list.splice(idx, 1);
    };
  },

  triggerMockData(sessionId: string, data: string) {
    const listeners = mockDataListeners.get(sessionId);
    if (listeners) {
      listeners.forEach((cb) => cb(data));
    }
  },
};
