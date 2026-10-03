// File extension -> language id for languages only installed extensions provide.
// Kept free of Monaco imports so the store can use it before the editor has loaded.
const extLanguages = new Map<string, string>();

export function setExtensionLanguage(extOrFileName: string, languageId: string) {
  extLanguages.set(extOrFileName.toLowerCase(), languageId);
}

export function extensionLanguageFor(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (extLanguages.has(lower)) return extLanguages.get(lower);
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? extLanguages.get(lower.slice(dot)) : undefined;
}
