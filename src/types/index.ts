export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number | null;
}

export interface FsError {
  kind: "NotFound" | "PermissionDenied" | "AlreadyExists" | "NotADirectory" | "NotUtf8" | "InvalidPath" | "Io";
  message?: string;
}

export interface PtySessionInfo {
  id: string;
  shell: string;
  cwd?: string;
}

export interface ToolStatus {
  name: string;
  path: string | null;
  available: boolean;
  purpose: string;
  installHint: string;
}

export interface UserSettings {
  theme: "dark" | "light";
  fontSize: number;
  tabWidth: number;
  shellPath?: string | null;
  runTimeoutSecs: number;
  lastFolder?: string | null;
}

export interface OpenFile {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

export interface OutputChunk {
  runId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export type RunStatus =
  | { phase: "compiling"; language: string }
  | { phase: "compileFailed"; exitCode?: number | null }
  | { phase: "running"; language: string; pid: number }
  | {
      phase: "finished";
      exitCode?: number | null;
      timedOut: boolean;
      stoppedByUser: boolean;
      durationMs: number;
      hint?: string | null;
    }
  | { phase: "failed"; message: string };
