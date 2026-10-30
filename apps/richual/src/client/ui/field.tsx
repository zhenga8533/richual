import type { ComponentProps } from "react";
import { cn } from "./cn";

const control =
  "h-10 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-fg placeholder:text-muted/70 transition-colors focus:border-accent focus:outline-none disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "w-auto pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers nest or reference the control
    <label className={cn("flex flex-col gap-1.5 text-sm font-medium", className)} {...props} />
  );
}
