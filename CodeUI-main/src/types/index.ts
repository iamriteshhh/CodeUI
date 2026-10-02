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
  recentFolders?: string[];
  showWelcomeOnStartup?: boolean;
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

export interface SearchResult {
  filePath: string;
  fileName: string;
  lineNumber: number;
  lineContent: string;
}

export interface ExtensionItem {
  id: string;
  name: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  downloads: string;
  rating: number;
  ratingCount: number;
  iconBg?: string;
  iconType?: string;
  iconUrl?: string;
  repositoryUrl?: string;
  license?: string;
  installed: boolean;
  enabled: boolean;
  size?: string;
  lastUpdated: string;
  published?: string;
  categories: string[];
  overviewHtml?: string;
  overviewMarkdown: string;
  features?: string[];
  changelog?: { version: string; date: string; changes: string[] }[];
  systemDetected?: boolean;
  systemToolPath?: string;
  blockedByPolicy?: boolean;
  blockReason?: string;
}
