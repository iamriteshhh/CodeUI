import { OutputChunk, RunStatus } from "../types";

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

export const processService = {
  async runFile(
    path: string,
    runId?: string,
    timeoutSecs?: number,
    size?: { cols: number; rows: number }
  ): Promise<string> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string>("run_file", { path, runId, timeoutSecs, cols: size?.cols, rows: size?.rows });
    }
    return runId || "mock-run-id";
  },

  async resizeRun(runId: string, cols: number, rows: number): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("resize_run", { runId, cols, rows });
    }
  },

  async stopRun(runId: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("stop_run", { runId });
    }
  },

  async writeRunStdin(runId: string, data: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("write_run_stdin", { runId, data });
    }
  },

  async closeRunStdin(runId: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("close_run_stdin", { runId });
    }
  },

  async onRunOutput(
    runId: string,
    callback: (chunk: OutputChunk) => void
  ): Promise<() => void> {
    const event = await getEvent();
    if (event) {
      return await event.listen<OutputChunk>(`run-output-${runId}`, (e) => {
        callback(e.payload);
      });
    }
    return () => {};
  },

  async onRunStatus(
    runId: string,
    callback: (status: RunStatus) => void
  ): Promise<() => void> {
    const event = await getEvent();
    if (event) {
      return await event.listen<RunStatus>(`run-status-${runId}`, (e) => {
        callback(e.payload);
      });
    }
    return () => {};
  },
};
