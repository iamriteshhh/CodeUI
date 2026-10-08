import { UserSettings } from "../types";
import { notify } from "./notify";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function getInvoke() {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke;
  }
  return null;
}

/**
 * The one frontend source of default settings (store initial state, Settings reset, fallbacks).
 * runTimeoutSecs mirrors DEFAULT_TIMEOUT_SECS in src-tauri/src/proc/mod.rs (enforced by a test).
 */
export const DEFAULT_SETTINGS: Readonly<UserSettings> = Object.freeze({
  theme: "dark",
  fontSize: 14,
  tabWidth: 4,
  shellPath: null,
  runTimeoutSecs: 30,
  lastFolder: null,
  recentFolders: [],
  showWelcomeOnStartup: true,
});

export const settingsService = {
  async loadSettings(): Promise<UserSettings> {
    const invoke = await getInvoke();
    if (invoke) {
      return { ...DEFAULT_SETTINGS, ...(await invoke<UserSettings>("load_settings")) };
    }
    if (import.meta.env.PROD) {
      throw new Error("Settings service is only available inside the Tauri desktop application.");
    }
    const saved = localStorage.getItem("codeui_settings");
    if (saved) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch {
        // use default
      }
    }
    return { ...DEFAULT_SETTINGS };
  },

  /** Persists settings. Failures are reported to the user; resolves false when nothing was saved. */
  async saveSettings(settings: UserSettings): Promise<boolean> {
    try {
      const invoke = await getInvoke();
      if (invoke) {
        await invoke<void>("save_settings", { settings });
      } else {
        localStorage.setItem("codeui_settings", JSON.stringify(settings));
      }
      return true;
    } catch (err) {
      notify.error("Settings not saved", err);
      return false;
    }
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
