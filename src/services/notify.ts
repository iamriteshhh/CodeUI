// Lightweight notification and error formatting service for user-facing feedback

export type ToastType = "error" | "warning" | "info" | "success";

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  detail?: string;
  duration?: number; // ms, or 0 / undefined for default
  timestamp: number;
}

type ToastListener = (toasts: ToastMessage[]) => void;

let toasts: ToastMessage[] = [];
const listeners: Set<ToastListener> = new Set();
let nextId = 1;

function emit() {
  for (const listener of listeners) {
    listener([...toasts]);
  }
}

export function formatError(err: unknown): string {
  if (!err) return "An unknown error occurred.";
  if (typeof err === "string") return err;

  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    // Backend errors are { kind, message } with message a complete sentence; kind is for code.
    if (typeof obj.message === "string") {
      return obj.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    try {
      const json = JSON.stringify(err);
      if (json !== "{}") return json;
    } catch {
      // ignore
    }
  }

  return String(err);
}

export const notify = {
  subscribe(listener: ToastListener): () => void {
    listeners.add(listener);
    listener([...toasts]);
    return () => {
      listeners.delete(listener);
    };
  },

  show(type: ToastType, title: string, detail?: string, duration = 6000): string {
    const id = `toast-${Date.now()}-${nextId++}`;
    const newToast: ToastMessage = {
      id,
      type,
      title,
      detail,
      duration,
      timestamp: Date.now(),
    };

    toasts = [...toasts, newToast];
    emit();

    if (duration > 0) {
      setTimeout(() => {
        notify.dismiss(id);
      }, duration);
    }

    return id;
  },

  error(title: string, detail?: unknown): string {
    const formattedDetail = detail !== undefined ? formatError(detail) : undefined;
    // Errors stay longer (10s) or until clicked
    return notify.show("error", title, formattedDetail, 10000);
  },

  warning(title: string, detail?: unknown): string {
    const formattedDetail = detail !== undefined ? formatError(detail) : undefined;
    return notify.show("warning", title, formattedDetail, 6000);
  },

  success(title: string, detail?: string): string {
    return notify.show("success", title, detail, 4000);
  },

  info(title: string, detail?: string): string {
    return notify.show("info", title, detail, 5000);
  },

  dismiss(id: string) {
    const prevLen = toasts.length;
    toasts = toasts.filter((t) => t.id !== id);
    if (toasts.length !== prevLen) {
      emit();
    }
  },

  clear() {
    toasts = [];
    emit();
  },
};
