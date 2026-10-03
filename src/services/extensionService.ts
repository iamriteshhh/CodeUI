import { invoke } from "@tauri-apps/api/core";
import { ExtensionItem, InstalledExtension } from "../types";
import { aiBlockReason } from "./aiPolicy";

export const EXTENSION_REGISTRY_MAP: Record<string, string> = {
  "anthropic.claude-code": "Anthropic/claude-code",
  "llvm-vs-code-extensions.vscode-clangd": "llvm-vs-code-extensions/vscode-clangd",
  "ms-azuretools.vscode-docker": "ms-azuretools/vscode-docker",
  "vscjava.vscode-java-debug": "vscjava/vscode-java-debug",
  "vscjava.vscode-java-pack": "vscjava/vscode-java-pack",
  "eamodio.gitlens": "eamodio/gitlens",
  "github.vscode-github-actions": "github/vscode-github-actions",
  "golang.go": "golang/Go",
  "ms-python.python": "ms-python/python",
  "rust-lang.rust-analyzer": "rust-lang/rust-analyzer",
  "ziglang.vscode-zig": "ziglang/vscode-zig",
};

const CACHE_KEY = "codeui_extensions_live_registry_v3";

function formatTimestamp(isoString?: string): string {
  if (!isoString) return "Recently";
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Recently";
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  } catch {
    return "Recently";
  }
}

/**
 * Loads cached live extension updates from localStorage to ensure 0ms instantaneous load
 */
export function getStoredLiveExtensions(): Record<string, Partial<ExtensionItem>> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Persists live updates to localStorage
 */
function saveStoredLiveExtensions(data: Record<string, Partial<ExtensionItem>>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Fetches live extension metadata and README from Open VSX Registry
 */
export async function fetchLiveExtensionDetails(id: string): Promise<Partial<ExtensionItem> | null> {
  const firstDot = id.indexOf(".");
  const registryPath =
    EXTENSION_REGISTRY_MAP[id] || (firstDot > 0 ? `${id.slice(0, firstDot)}/${id.slice(firstDot + 1)}` : null);
  if (!registryPath) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`https://open-vsx.org/api/${registryPath}`, {
      headers: { "User-Agent": "CodeUI-IDE" },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) return null;
    const data = await response.json();

    const partial: Partial<ExtensionItem> = {
      version: data.version || undefined,
      description: data.description || undefined,
      downloads: typeof data.downloadCount === "number" ? data.downloadCount.toLocaleString() : undefined,
      rating: typeof data.averageRating === "number" ? Math.round(data.averageRating * 10) / 10 : 0,
      ratingCount: typeof data.reviewCount === "number" ? data.reviewCount : 0,
      lastUpdated: formatTimestamp(data.timestamp),
      repositoryUrl: data.repository || undefined,
      license: data.license || undefined,
      categories: Array.isArray(data.categories) ? data.categories : undefined,
    };

    if (data.displayName) {
      partial.displayName = data.displayName;
    }

    if (data.files?.icon) {
      partial.iconUrl = data.files.icon;
    }

    // Fetch publisher's real README
    if (data.files?.readme) {
      try {
        const readmeCtrl = new AbortController();
        const readmeTimer = setTimeout(() => readmeCtrl.abort(), 8000);
        const readmeRes = await fetch(data.files.readme, {
          headers: { "User-Agent": "CodeUI-IDE" },
          signal: readmeCtrl.signal,
        });
        clearTimeout(readmeTimer);
        if (readmeRes.ok) {
          const readmeText = await readmeRes.text();
          if (readmeText && readmeText.trim().length > 20) {
            partial.overviewMarkdown = readmeText.trim();
          }
        }
      } catch {
        // Retain existing markdown overview if readme fetch fails
      }
    }

    return partial;
  } catch {
    return null;
  }
}

/**
 * Syncs all registry-linked extensions live in the background
 */
export async function syncAllExtensionsLive(
  currentList: ExtensionItem[],
  onUpdated: (updatedList: ExtensionItem[]) => void
): Promise<void> {
  const cache = getStoredLiveExtensions();

  const syncPromises = currentList.map(async (ext) => {
    const registryPath = EXTENSION_REGISTRY_MAP[ext.id];
    if (!registryPath) return ext;

    const liveData = await fetchLiveExtensionDetails(ext.id);
    if (!liveData) return ext;

    cache[ext.id] = liveData;

    return {
      ...ext,
      ...liveData,
      installed: ext.installed,
      license: liveData.license || ext.license,
      overviewMarkdown:
        liveData.overviewMarkdown && liveData.overviewMarkdown.length > 20
          ? liveData.overviewMarkdown
          : ext.overviewMarkdown,
      categories: liveData.categories || ext.categories,
      repositoryUrl: liveData.repositoryUrl || ext.repositoryUrl,
    };
  });

  const results = await Promise.allSettled(syncPromises);
  const updatedList = results.map((r, i) => (r.status === "fulfilled" ? r.value : currentList[i]));

  saveStoredLiveExtensions(cache);
  onUpdated(updatedList);
}

/**
 * Lab policy: AI assistants and AI code completion are never installable.
 * The Rust installer enforces the same rules (src-tauri/ai-policy.json); this only drives the UI.
 */
export function isAiExtension(ext: {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  publisher?: string;
  categories?: string[];
}): boolean {
  return aiReason(ext) !== null;
}

export function aiReason(ext: {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  publisher?: string;
  categories?: string[];
}): string | null {
  const text = [ext.name, ext.displayName, ext.description, ext.publisher, ...(ext.categories || [])].join(" ");
  return aiBlockReason(ext.id || "", text);
}

/**
 * Searches the live Open VSX Marketplace directly
 */
export async function searchOpenVsxMarketplace(query: string): Promise<ExtensionItem[]> {
  if (!query.trim()) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);

    const res = await fetch(
      `https://open-vsx.org/api/-/search?query=${encodeURIComponent(query)}&size=20`,
      {
        headers: { "User-Agent": "CodeUI-IDE" },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    if (!res.ok) return [];
    const json = await res.json();

    if (!json.extensions || !Array.isArray(json.extensions)) return [];

    return json.extensions.map((item: any) => {
      const id = `${item.namespace}.${item.name}`;
      const name = item.name;
      const displayName = item.displayName || item.name;
      const publisher = item.namespaceDisplayName || item.namespace;
      const description = item.description || "No description provided";
      const categories = item.categories || ["Tools"];
      const blocked = isAiExtension({ id, name, displayName, publisher, description, categories });

      return {
        id,
        name,
        displayName,
        publisher,
        version: item.version || "1.0.0",
        description,
        downloads: typeof item.downloadCount === "number" ? item.downloadCount.toLocaleString() : "0",
        rating: typeof item.averageRating === "number" ? Math.round(item.averageRating * 10) / 10 : 0,
        ratingCount: typeof item.reviewCount === "number" ? item.reviewCount : 0,
        installed: false,
        enabled: !blocked,
        blockedByPolicy: blocked,
        blockReason: blocked ? "Restricted by security policy: AI assistants are disabled." : undefined,
        lastUpdated: formatTimestamp(item.timestamp),
        license: item.license || "Open Source",
        categories,
        overviewMarkdown: "", // Dynamically fetched when opened
        iconUrl: item.files?.icon,
        repositoryUrl: item.repository || undefined,
      };
    });
  } catch {
    return [];
  }
}

// --- Real installs (Rust backend: src-tauri/src/commands/extensions.rs) ---

export const listInstalledExtensions = () => invoke<InstalledExtension[]>("list_extensions");
export const installExtension = (id: string) => invoke<InstalledExtension>("install_extension", { id });
export const uninstallExtension = (id: string) => invoke<void>("uninstall_extension", { id });
export const setExtensionEnabled = (id: string, enabled: boolean) =>
  invoke<void>("set_extension_enabled", { id, enabled });
export const readExtensionFile = (id: string, path: string) => invoke<string>("read_extension_file", { id, path });
