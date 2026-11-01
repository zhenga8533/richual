import { Dialog, Popover, Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

// Tabs and the menu live in their own modules so the landing page can load them
// without the dialog and popover code.
export * from "./menu";
export * from "./tabs";

// ---------- Popover ----------

export const PopoverRoot = Popover.Root;
export const PopoverAnchor = Popover.Anchor;
export const PopoverTrigger = Popover.Trigger;

export function PopoverContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof Popover.Content>) {
  return (
    <Popover.Portal>
      <Popover.Content
        sideOffset={sideOffset}
        collisionPadding={12}
        className={cn(
          "z-50 w-80 max-w-[calc(100vw-24px)] rounded-xl border border-line bg-surface p-4 text-fg shadow-pop outline-none card-reveal",
          className,
        )}
        {...props}
      />
    </Popover.Portal>
  );
}

export const PopoverClose = Popover.Close;

// ---------- Bottom sheet ----------

/**
 * A dialog that slides up from the bottom on phones. Non-modal for the same
 * CSP reason as the menu in ./menu, so it draws its own backdrop.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        {open && (
          <div
            className="fixed inset-0 z-40 bg-black/40"
            aria-hidden
            onClick={() => onOpenChange(false)}
          />
        )}
        <Dialog.Content
          className="sheet-up fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-fg shadow-pop outline-none"
          aria-describedby={undefined}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" aria-hidden />
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------- Switch ----------

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "inline-flex h-6 w-10 shrink-0 items-center rounded-full border border-line-strong bg-surface-3 p-0.5 transition-colors disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-4.5 rounded-full bg-fg shadow transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-accent-fg" />
    </SwitchPrimitive.Root>
  );
}
