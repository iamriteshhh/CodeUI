import { FileEntry } from "../types";

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
const mockFs = new Map<string, string>([
  ["D:\\JAVA\\p1.java", `public class p1 {\n    public static void main(String[] args) {\n        System.out.println("Hello CodeUI!");\n    }\n}`],
  ["D:\\JAVA\\p2.java", `import java.util.Scanner;\n\nclass CheckDivisibility {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        System.out.print("Enter the number: ");\n        int n = sc.nextInt();\n        if (n % 5 == 0 && n % 11 == 0) {\n            System.out.println("The number is divisible by both 5 and 11");\n        } else {\n            System.out.println("The number is not divisible by both 5 and 11");\n        }\n        sc.close();\n    }\n}`],
  ["D:\\JAVA\\index.html", `<!DOCTYPE html>\n<html>\n<head>\n  <title>Preview Demo</title>\n  <style>\n    body { font-family: sans-serif; background: #1e1e1e; color: #fff; padding: 20px; }\n    h1 { color: #61dafb; }\n    .box { border: 1px solid #444; border-radius: 8px; padding: 15px; margin-top: 15px; }\n  </style>\n</head>\n<body>\n  <h1>Live Web Preview</h1>\n  <p>Edit this HTML file to see changes live in CodeUI!</p>\n  <div class="box">\n    <p>Lab-friendly static preview is active.</p>\n  </div>\n</body>\n</html>`],
  ["D:\\JAVA\\test.py", `print("Hello from Python 3!")\nname = input("Enter your name: ")\nprint(f"Welcome, {name}!")`]
]);

export const fsService = {
  async readFile(path: string): Promise<string> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string>("read_file", { path });
    }
    if (mockFs.has(path)) {
      return mockFs.get(path)!;
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
    // Return mock entries if in standalone web
    const entries: FileEntry[] = [
      { name: "p1.java", path: `${path}\\p1.java`, is_dir: false, size: 104, modified: Date.now() / 1000 },
      { name: "p2.java", path: `${path}\\p2.java`, is_dir: false, size: 412, modified: Date.now() / 1000 },
      { name: "index.html", path: `${path}\\index.html`, is_dir: false, size: 380, modified: Date.now() / 1000 },
      { name: "test.py", path: `${path}\\test.py`, is_dir: false, size: 95, modified: Date.now() / 1000 }
    ];
    return entries;
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
  }
};
