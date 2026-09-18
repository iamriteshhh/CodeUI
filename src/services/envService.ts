import { ToolStatus } from "../types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getInvoke() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  return null;
}

const mockTools: ToolStatus[] = [
  {
    name: "gcc",
    path: null,
    available: false,
    purpose: "Compiles C programs",
    installHint: "sudo apt install build-essential",
  },
  {
    name: "g++",
    path: null,
    available: false,
    purpose: "Compiles C++ programs",
    installHint: "sudo apt install build-essential",
  },
  {
    name: "python3",
    path: "C:\\Python312\\python.exe",
    available: true,
    purpose: "Runs Python programs",
    installHint: "sudo apt install python3",
  },
  {
    name: "javac",
    path: "C:\\Program Files\\Java\\jdk-21\\bin\\javac.exe",
    available: true,
    purpose: "Compiles Java programs",
    installHint: "sudo apt install default-jdk",
  },
  {
    name: "java",
    path: "C:\\Program Files\\Java\\jdk-21\\bin\\java.exe",
    available: true,
    purpose: "Runs compiled Java programs",
    installHint: "sudo apt install default-jre",
  },
  {
    name: "sf",
    path: null,
    available: false,
    purpose: "Compiles and runs Salivo programs",
    installHint: "Install the Salivo toolchain, then add ~/.salivo/bin to your PATH",
  },
];

export const envService = {
  async detectTools(): Promise<ToolStatus[]> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<ToolStatus[]>("detect_tools");
    }
    return mockTools;
  },

  async allToolsAvailable(): Promise<boolean> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<boolean>("all_tools_available");
    }
    return false;
  },
};
