/**
 * fontCheck.ts — Runtime font validation and monospace self-check for CodeUI (R3)
 * Guarantees glyph metrics match before Monaco measures character cells.
 */

export const DEFAULT_MONO_STACK =
  '"CodeUI Mono", Consolas, "Courier New", monospace';

export const FALLBACK_MONO_STACK =
  'Consolas, "Courier New", monospace';

export interface FontMetricsCheckResult {
  isMonospace: boolean;
  charWidthDiff: number;
  widthI: number;
  widthW: number;
  fontUsed: string;
}

/**
 * Checks whether a given font family renders strictly monospaced characters.
 * Compares the advance width of 20 'i' glyphs vs 20 'W' glyphs.
 */
export function checkMonospaceMetrics(
  fontFamily: string = DEFAULT_MONO_STACK,
  fontSize: number = 14
): FontMetricsCheckResult {
  if (typeof document === "undefined") {
    return {
      isMonospace: true,
      charWidthDiff: 0,
      widthI: 0,
      widthW: 0,
      fontUsed: fontFamily,
    };
  }

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        isMonospace: true,
        charWidthDiff: 0,
        widthI: 0,
        widthW: 0,
        fontUsed: fontFamily,
      };
    }

    ctx.font = `${fontSize}px ${fontFamily}`;
    const sampleI = "iiiiiiiiiiiiiiiiiiii"; // 20 chars
    const sampleW = "WWWWWWWWWWWWWWWWWWWW"; // 20 chars

    const widthI = ctx.measureText(sampleI).width;
    const widthW = ctx.measureText(sampleW).width;
    const diff = Math.abs(widthI - widthW);

    // In a truly monospaced font, 20 'i's and 20 'W's have identical advance width (diff < 0.5px)
    const isMonospace = diff < 0.5;

    return {
      isMonospace,
      charWidthDiff: diff,
      widthI,
      widthW,
      fontUsed: fontFamily,
    };
  } catch {
    return {
      isMonospace: true,
      charWidthDiff: 0,
      widthI: 0,
      widthW: 0,
      fontUsed: fontFamily,
    };
  }
}

/**
 * Ensures "CodeUI Mono" or its fallback font has loaded into the browser font cache
 * before Monaco initializes, and triggers remeasurement to prevent overlapping text.
 */
export async function ensureMonacoFontsReady(monacoInstance?: any): Promise<string> {
  if (typeof document === "undefined" || !document.fonts) {
    if (monacoInstance?.editor?.remeasureFonts) {
      monacoInstance.editor.remeasureFonts();
    }
    return DEFAULT_MONO_STACK;
  }

  try {
    // 1. Explicitly load the primary bundled font with a 750ms timeout
    if (document.fonts.load) {
      await Promise.race([
        document.fonts.load('14px "CodeUI Mono"'),
        document.fonts.ready,
        new Promise((res) => setTimeout(res, 750)),
      ]);
    }

    // 2. Perform monospace self-check
    const metrics = checkMonospaceMetrics(DEFAULT_MONO_STACK, 14);
    let chosenFont = DEFAULT_MONO_STACK;

    if (!metrics.isMonospace && metrics.charWidthDiff > 1.0) {
      console.warn(
        `[CodeUI FontCheck] Primary font "${DEFAULT_MONO_STACK}" is not monospaced (diff: ${metrics.charWidthDiff.toFixed(2)}px). Falling back to system monospace.`
      );
      chosenFont = FALLBACK_MONO_STACK;
    }

    // 3. Remeasure Monaco fonts if an instance is provided
    if (monacoInstance?.editor?.remeasureFonts) {
      monacoInstance.editor.remeasureFonts();
    }

    return chosenFont;
  } catch (err) {
    console.warn("[CodeUI FontCheck] Font loading warning:", err);
    return DEFAULT_MONO_STACK;
  }
}
