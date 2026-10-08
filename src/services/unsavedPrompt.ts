// One reusable "unsaved changes" prompt, rendered by <UnsavedChangesDialog /> (same bus pattern as notify/Toasts).

export type UnsavedChoice = "save" | "discard" | "cancel";

export interface UnsavedPromptRequest {
  title: string;
  message: string;
  /** Names of the files with unsaved changes. */
  files: string[];
  /** False hides "Save All" (e.g. the files are about to be deleted). */
  allowSave?: boolean;
  /** Label for the discard button (default "Don't Save"). */
  discardLabel?: string;
}

export interface PendingUnsavedPrompt extends UnsavedPromptRequest {
  resolve: (choice: UnsavedChoice) => void;
}

type Listener = (prompt: PendingUnsavedPrompt | null) => void;

let listener: Listener | null = null;
let pending: PendingUnsavedPrompt | null = null;

export const unsavedPrompt = {
  /** Called by the dialog host. Only one host is supported. */
  subscribe(l: Listener): () => void {
    listener = l;
    l(pending);
    return () => {
      if (listener === l) listener = null;
    };
  },

  /** Asks the user what to do with unsaved changes. Resolves "cancel" if no dialog host is mounted or one is already open. */
  ask(request: UnsavedPromptRequest): Promise<UnsavedChoice> {
    if (!listener || pending) return Promise.resolve("cancel");
    return new Promise<UnsavedChoice>((resolve) => {
      pending = {
        ...request,
        resolve: (choice) => {
          pending = null;
          listener?.(null);
          resolve(choice);
        },
      };
      listener?.(pending);
    });
  },
};
