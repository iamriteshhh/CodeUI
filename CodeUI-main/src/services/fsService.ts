import { FileEntry, SearchResult } from "../types";

// Check if running inside Tauri webview
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getInvoke() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  return null;
}

// In-memory fallback workspace for testing outside Tauri webview
const mockFs = new Map<string, string>();

export const fsService = {
  async readFile(path: string): Promise<string> {
    const invoke = await getInvoke();
    if (invoke) {
      const raw = await invoke<string>("read_file", { path });
      return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }
    if (mockFs.has(path)) {
      return mockFs.get(path)!.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }
    throw new Error(`File not found: ${path}`);
  },

  async writeFile(path: string, contents: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("write_file", { path, contents });
    }
    mockFs.set(path, contents);
  },

  async listDir(path: string): Promise<FileEntry[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<FileEntry[]>("list_dir", { path });
    }
    // Return in-memory mock entries if in standalone web
    const entries: FileEntry[] = [];
    const normalizedPrefix = path.endsWith("/") || path.endsWith("\\") ? path : path + "/";
    for (const [filePath, content] of mockFs.entries()) {
      if (filePath.startsWith(normalizedPrefix) || filePath.startsWith(path)) {
        const rest = filePath.slice(normalizedPrefix.length);
        if (rest && !rest.includes("/") && !rest.includes("\\")) {
          entries.push({
            name: rest,
            path: filePath,
            is_dir: false,
            size: content.length,
            modified: Date.now() / 1000,
          });
        }
      }
    }
    return entries;
  },

  async exists(path: string): Promise<boolean> {
    const invoke = await getInvoke();
    if (invoke) {
      try {
        await invoke<FileEntry[]>("list_dir", { path });
        return true;
      } catch {
        try {
          await invoke<string>("read_file", { path });
          return true;
        } catch {
          return false;
        }
      }
    }
    return mockFs.has(path);
  },

  async createFile(path: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("create_file", { path });
    }
    if (mockFs.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    mockFs.set(path, "");
  },

  async createDir(path: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("create_dir", { path });
    }
  },

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("rename_file", { oldPath, newPath });
    }
    if (mockFs.has(oldPath)) {
      const content = mockFs.get(oldPath)!;
      mockFs.delete(oldPath);
      mockFs.set(newPath, content);
    }
  },

  async deleteFile(path: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("delete_file", { path });
    }
    mockFs.delete(path);
  },

  async pathExists(path: string): Promise<boolean> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<boolean>("path_exists", { path });
    }
    return mockFs.has(path);
  },

  async pickFolder(defaultPath?: string): Promise<string | null> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string | null>("pick_folder", { defaultPath });
    }
    // Fallback for browsers running outside Tauri
    if (typeof window !== "undefined" && "showDirectoryPicker" in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        if (dirHandle && dirHandle.name) {
          return dirHandle.name;
        }
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return null;
        }
      }
    }
    const target = prompt("Enter folder path to open:", defaultPath || "");
    return target && target.trim() ? target.trim() : null;
  },

  async pickFile(defaultPath?: string): Promise<string | null> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string | null>("pick_file", { defaultPath });
    }
    return null;
  },

  async openInFileManager(path: string): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      await invoke<void>("open_in_file_manager", { path });
    }
  },

  async searchFiles(
    workspacePath: string,
    query: string,
    caseSensitive: boolean = false,
    maxResults: number = 100
  ): Promise<SearchResult[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<SearchResult[]>("search_files", {
        workspacePath,
        query,
        caseSensitive,
        maxResults,
      });
    }

    // Mock search for standalone browser preview
    const results: SearchResult[] = [];
    const q = caseSensitive ? query : query.toLowerCase();
    for (const [path, content] of mockFs.entries()) {
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        const match = caseSensitive ? line.includes(q) : line.toLowerCase().includes(q);
        if (match) {
          const fileName = path.split(/[/\\]/).pop() || path;
          results.push({
            filePath: path,
            fileName,
            lineNumber: idx + 1,
            lineContent: line.trim(),
          });
        }
      });
    }
    return results.slice(0, maxResults);
  },

  async findFiles(
    workspacePath: string,
    query: string = "",
    maxResults: number = 50
  ): Promise<FileEntry[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<FileEntry[]>("find_files", {
        workspacePath,
        query,
        maxResults,
      });
    }

    // Mock findFiles for standalone preview
    const q = query.toLowerCase();
    const entries: FileEntry[] = [];
    for (const path of mockFs.keys()) {
      const fileName = path.split(/[/\\]/).pop() || path;
      if (!q || fileName.toLowerCase().includes(q) || path.toLowerCase().includes(q)) {
        entries.push({
          name: fileName,
          path,
          is_dir: false,
          size: 0,
          modified: null,
        });
      }
    }
    return entries.slice(0, maxResults);
  }
};

