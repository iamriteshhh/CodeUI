import { describe, it, expect } from "vitest";
import procModRs from "../../src-tauri/src/proc/mod.rs?raw";
import { DEFAULT_SETTINGS } from "./settingsService";

describe("settings defaults", () => {
  it("run timeout default matches the Rust single source (DEFAULT_TIMEOUT_SECS)", () => {
    const match = procModRs.match(/pub\s+const\s+DEFAULT_TIMEOUT_SECS\s*:\s*u64\s*=\s*(\d+)\s*;/);
    expect(match, "DEFAULT_TIMEOUT_SECS not found in src-tauri/src/proc/mod.rs").not.toBeNull();
    expect(DEFAULT_SETTINGS.runTimeoutSecs).toBe(Number(match![1]));
  });
});
