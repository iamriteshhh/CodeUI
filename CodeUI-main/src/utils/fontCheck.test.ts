import { describe, it, expect, vi } from "vitest";
import {
  checkMonospaceMetrics,
  ensureMonacoFontsReady,
  DEFAULT_MONO_STACK,
  FALLBACK_MONO_STACK,
} from "./fontCheck";

describe("fontCheck monospace validation", () => {
  it("exposes valid font stack strings with proper fallbacks", () => {
    expect(DEFAULT_MONO_STACK).toContain("CodeUI Mono");
    expect(DEFAULT_MONO_STACK).toContain("Consolas");
    expect(DEFAULT_MONO_STACK).toContain("Courier New");
    expect(DEFAULT_MONO_STACK).toContain("monospace");

    expect(FALLBACK_MONO_STACK).toContain("Consolas");
    expect(FALLBACK_MONO_STACK).toContain("Courier New");
    expect(FALLBACK_MONO_STACK).toContain("monospace");
    expect(FALLBACK_MONO_STACK).not.toContain("CodeUI Mono");
  });

  it("checks metrics safely across multiple font sizes (12, 14, 18, 24)", () => {
    const sizes = [12, 14, 18, 24];
    for (const size of sizes) {
      const result = checkMonospaceMetrics(DEFAULT_MONO_STACK, size);
      expect(result).toBeDefined();
      expect(typeof result.isMonospace).toBe("boolean");
      expect(typeof result.charWidthDiff).toBe("number");
      expect(result.fontUsed).toBe(DEFAULT_MONO_STACK);
    }
  });

  it("calls remeasureFonts when monaco instance is provided to ensureMonacoFontsReady", async () => {
    const mockRemeasure = vi.fn();
    const mockMonaco = {
      editor: {
        remeasureFonts: mockRemeasure,
      },
    };

    const chosen = await ensureMonacoFontsReady(mockMonaco);
    expect(chosen).toBeDefined();
    expect(mockRemeasure).toHaveBeenCalledTimes(1);
  });
});
