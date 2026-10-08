import { describe, it, expect, vi } from "vitest";
import { dirtyFiles, nextRecentFolders, resolveUnsaved } from "./workspaceGuards";
import { unsavedPrompt } from "../services/unsavedPrompt";
import { OpenFile } from "../types";

const file = (path: string, isDirty: boolean): OpenFile => ({
  path,
  name: path.split("/").pop() || path,
  content: "",
  isDirty,
  language: "plaintext",
});

const request = { title: "t", message: "m" };

describe("workspace guards", () => {
  it("dirtyFiles returns only tabs with unsaved edits", () => {
    const files = [file("/w/a.py", false), file("/w/b.py", true), file("/w/c.py", true)];
    expect(dirtyFiles(files).map((f) => f.path)).toEqual(["/w/b.py", "/w/c.py"]);
  });

  it("nextRecentFolders puts the folder first, dedupes and caps", () => {
    expect(nextRecentFolders(["/a", "/b", "/c"], "/b")).toEqual(["/b", "/a", "/c"]);
    expect(nextRecentFolders(["/a", "/b"], "/c", 2)).toEqual(["/c", "/a"]);
  });

  it("proceeds without prompting when nothing is dirty", async () => {
    const ask = vi.fn();
    const save = vi.fn();
    await expect(resolveUnsaved([], ask, save, request)).resolves.toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("cancel aborts and saves nothing", async () => {
    const save = vi.fn();
    const ok = await resolveUnsaved([file("/w/a.py", true)], async () => "cancel", save, request);
    expect(ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("don't save proceeds without saving", async () => {
    const save = vi.fn();
    const ok = await resolveUnsaved([file("/w/a.py", true)], async () => "discard", save, request);
    expect(ok).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("save all saves every dirty file and proceeds", async () => {
    const save = vi.fn(async (_path: string) => true);
    const dirty = [file("/w/a.py", true), file("/w/b.py", true)];
    const ask = vi.fn(async () => "save" as const);
    await expect(resolveUnsaved(dirty, ask, save, request)).resolves.toBe(true);
    expect(ask).toHaveBeenCalledWith({ ...request, files: ["a.py", "b.py"] });
    expect(save.mock.calls.map((c) => c[0])).toEqual(["/w/a.py", "/w/b.py"]);
  });

  it("a failed save aborts the action", async () => {
    const save = vi.fn(async (path: string) => path !== "/w/a.py");
    const dirty = [file("/w/a.py", true), file("/w/b.py", true)];
    await expect(resolveUnsaved(dirty, async () => "save", save, request)).resolves.toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("the prompt cancels when no dialog is mounted, and resolves the user's choice when one is", async () => {
    await expect(unsavedPrompt.ask({ ...request, files: ["a.py"] })).resolves.toBe("cancel");

    const unsubscribe = unsavedPrompt.subscribe((p) => p?.resolve("discard"));
    await expect(unsavedPrompt.ask({ ...request, files: ["a.py"] })).resolves.toBe("discard");
    unsubscribe();
  });
});
