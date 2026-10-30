import { X } from "lucide-react";
import { dismissToast, useToasts } from "../toasts";
import { cn } from "../ui/cn";

/** Brief notices, stacked at the bottom out of the way of the game. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <ol
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <li
          key={t.id}
          role="status"
          className={cn(
            "card-reveal pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border bg-surface py-2 pr-2 pl-4 text-sm shadow-pop",
            t.tone === "error" && "border-danger/50",
            t.tone === "good" && "border-emerald-500/50",
            t.tone === "info" && "border-line",
          )}
        >
          <span className="flex-1">{t.text}</span>
          <button
            type="button"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </button>
        </li>
      ))}
    </ol>
  );
}
