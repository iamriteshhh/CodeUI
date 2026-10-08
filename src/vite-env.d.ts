/// <reference types="vite/client" />

declare module "*.png" {
  const value: string;
  export default value;
}

declare module "*.svg" {
  const value: string;
  export default value;
}

declare module "*.jpg" {
  const value: string;
  export default value;
}

declare module "*?worker" {
  const workerConstructor: {
    new (): Worker;
  };
  export default workerConstructor;
}

declare module "*monaco-editor/esm/vs/languages/definitions/*" {
  export const conf: import("monaco-editor").languages.LanguageConfiguration;
  export const language: import("monaco-editor").languages.IMonarchLanguage;
}


declare module "monaco-esm/*";
