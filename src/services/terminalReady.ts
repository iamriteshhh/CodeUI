// The terminal panel mounts on first use (not at startup), so a run started from a hidden panel
// must wait until TerminalPanel is listening for "codeui-run-start" before dispatching it.
let markReady: () => void = () => {};
export const terminalReady = new Promise<void>((resolve) => (markReady = resolve));
export const markTerminalReady = () => markReady();

/** Dispatched on window after the workspace changed or closed; TerminalPanel drops its shell and run bindings. */
export const WORKSPACE_RESET_EVENT = "codeui-workspace-reset";
