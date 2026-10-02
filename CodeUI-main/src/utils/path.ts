/**
 * Cross-platform path utilities for CodeUI
 * Supports both Windows (C:\path\to\file) and POSIX (/path/to/file) formats.
 */

const WINDOWS_RESERVED_NAMES = new Set([
  "con", "prn", "aux", "nul",
  "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
  "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
]);

/**
 * Detects the preferred separator of a path.
 * Windows drive letters (e.g. C:) or backslashes indicate Windows path syntax.
 */
export function sepOf(path: string): "\\" | "/" {
  if (!path) return "/";
  if (/^[A-Za-z]:/.test(path) || path.includes("\\")) {
    return "\\";
  }
  return "/";
}

/**
 * Normalizes slashes to forward slashes for comparisons
 */
export function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Joins a parent directory path and a child name without double separators
 */
export function join(parent: string, name: string): string {
  if (!parent) return name;
  if (!name) return parent;

  const sep = sepOf(parent);
  const cleanParent = parent.replace(/[/\\]+$/, "");
  const cleanName = name.replace(/^[/\\]+/, "");
  return `${cleanParent}${sep}${cleanName}`;
}

/**
 * Extracts directory name of a path
 */
export function dirname(path: string): string {
  if (!path) return "";
  const sep = sepOf(path);
  const clean = path.replace(/[/\\]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx < 0) return "";
  if (idx === 0) return clean.startsWith("/") ? "/" : "";
  // Check Windows drive root: e.g. "C:\"
  if (/^[A-Za-z]:$/.test(clean.slice(0, idx))) {
    return clean.slice(0, idx) + sep;
  }
  return clean.slice(0, idx);
}

/**
 * Extracts basename of a path
 */
export function basename(path: string): string {
  if (!path) return "";
  const clean = path.replace(/[/\\]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (idx < 0) return clean;
  return clean.slice(idx + 1);
}

/**
 * Checks whether `child` is equal to or located inside `ancestor`.
 * Case-insensitive on Windows paths.
 */
export function isInside(child: string, ancestor: string): boolean {
  if (!child || !ancestor) return false;

  const normChild = normalizeSlashes(child).replace(/\/+$/, "");
  const normAncestor = normalizeSlashes(ancestor).replace(/\/+$/, "");

  const isWindows = /^[A-Za-z]:/.test(child) || /^[A-Za-z]:/.test(ancestor);
  const c = isWindows ? normChild.toLowerCase() : normChild;
  const a = isWindows ? normAncestor.toLowerCase() : normAncestor;

  if (c === a) return true;
  return c.startsWith(a + "/");
}

/**
 * Rebases a path when its parent/ancestor directory is renamed.
 * e.g. rebase("C:\proj\src\index.ts", "C:\proj", "C:\new_proj") -> "C:\new_proj\src\index.ts"
 */
export function rebase(path: string, oldPrefix: string, newPrefix: string): string {
  if (!path || !oldPrefix) return path;

  const sep = sepOf(newPrefix || oldPrefix || path);
  const normPath = normalizeSlashes(path);
  const normOld = normalizeSlashes(oldPrefix).replace(/\/+$/, "");
  const normNew = normalizeSlashes(newPrefix).replace(/\/+$/, "");

  const isWindows = /^[A-Za-z]:/.test(path) || /^[A-Za-z]:/.test(oldPrefix);
  const matchPath = isWindows ? normPath.toLowerCase() : normPath;
  const matchOld = isWindows ? normOld.toLowerCase() : normOld;

  if (matchPath === matchOld) {
    return normNew.replace(/\//g, sep);
  }

  if (matchPath.startsWith(matchOld + "/")) {
    const relative = normPath.slice(normOld.length + 1);
    const rebased = `${normNew}/${relative}`;
    return rebased.replace(/\//g, sep);
  }

  return path;
}

/**
 * Validates a file or directory name.
 * Returns null if valid, or a user-facing error message if invalid.
 */
export function validateName(name: string): string | null {
  if (!name || !name.trim()) {
    return "Name cannot be empty.";
  }

  const trimmed = name.trim();

  if (trimmed === "." || trimmed === "..") {
    return `"${trimmed}" is not a valid file or folder name.`;
  }

  if (trimmed.length > 255) {
    return "Name cannot exceed 255 characters.";
  }

  // Illegal characters: / \ : * ? " < > | and control characters
  if (/[\\/:*?"<>|\x00-\x1f]/.test(trimmed)) {
    return 'Name cannot contain any of the following characters: \\ / : * ? " < > |';
  }

  // Windows trailing dot or space
  if (/[. ]$/.test(name)) {
    return "Name cannot end with a period or space.";
  }

  // Windows reserved device names (e.g. CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  const baseWithoutExt = trimmed.split(".")[0].toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(baseWithoutExt)) {
    return `"${baseWithoutExt.toUpperCase()}" is a reserved system name.`;
  }

  return null;
}
