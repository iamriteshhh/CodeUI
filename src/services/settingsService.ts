import { UserSettings } from "../types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getInvoke() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  return null;
}

const defaultSettings: UserSettings = {
  theme: "dark",
  fontSize: 14,
  tabWidth: 4,
  shellPath: null,
  runTimeoutSecs: 30,
  lastFolder: null,
  recentFolders: [],
  showWelcomeOnStartup: true,
};

export const settingsService = {
  async loadSettings(): Promise<UserSettings> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<UserSettings>("load_settings");
    }
    if (import.meta.env.PROD) {
      throw new Error("Settings service is only available inside the Tauri desktop application.");
    }
    const saved = localStorage.getItem("codeui_settings");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // use default
      }
    }
    return defaultSettings;
  },

  async saveSettings(settings: UserSettings): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("save_settings", { settings });
    }
    localStorage.setItem("codeui_settings", JSON.stringify(settings));
  },

  async flushSettings(): Promise<void> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<void>("flush_settings");
    }
  },

  async getSettingsFilePath(): Promise<string> {
    const invoke = await getInvoke();
    if (invoke) {
      return await invoke<string>("settings_file_path");
    }
    return "~/.config/codeui/settings.json";
  },
};
