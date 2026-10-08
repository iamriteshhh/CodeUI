import { OpenFile } from "../types";
import { UnsavedChoice, UnsavedPromptRequest } from "../services/unsavedPrompt";

/** Open tabs with edits that are not on disk. */
export function dirtyFiles(files: readonly OpenFile[]): OpenFile[] {
  return files.filter((f) => f.isDirty);
}

/** Most-recent-first list of folders, deduplicated and capped. */
export function nextRecentFolders(prev: readonly string[], folder: string, max = 10): string[] {
  return [folder, ...prev.filter((p) => p !== folder)].slice(0, max);
}

/**
 * Lets the user keep, save or discard unsaved edits before a destructive action.
 * Resolves true when the action may proceed: nothing dirty, "Don't Save", or "Save All" with every save succeeding.
 * Cancel or any failed save resolves false (the action must be aborted).
 */
export async function resolveUnsaved(
  dirty: readonly OpenFile[],
  ask: (request: UnsavedPromptRequest) => Promise<UnsavedChoice>,
  save: (path: string) => Promise<boolean>,
  request: Omit<UnsavedPromptRequest, "files">
): Promise<boolean> {
  if (dirty.length === 0) return true;
  const choice = await ask({ ...request, files: dirty.map((f) => f.name) });
  if (choice === "cancel") return false;
  if (choice === "discard") return true;
  for (const f of dirty) {
    if (!(await save(f.path))) return false;
  }
  return true;
}
