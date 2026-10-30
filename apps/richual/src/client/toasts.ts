import { create } from "zustand";

export type Toast = { id: number; text: string; tone: "info" | "good" | "error" };

const TOAST_MS = 4_500;
const MAX_TOASTS = 3;

export const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }));

let nextId = 0;

/** Shows a brief message; the oldest is dropped when too many are on screen. */
export function pushToast(text: string, tone: Toast["tone"] = "info"): void {
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-MAX_TOASTS) }));
  setTimeout(() => dismissToast(id), TOAST_MS);
}

export function dismissToast(id: number): void {
  useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}
