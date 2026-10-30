import { DropdownMenu, Popover, Switch as SwitchPrimitive, Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn";

// ---------- Tabs ----------

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-1 rounded-lg bg-surface-2 p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted transition-colors hover:text-fg data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content className={cn("focus-visible:outline-none", className)} {...props} />
  );
}

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

// ---------- Dropdown menu ----------

/**
 * Non-modal: a modal menu locks page scroll by injecting an inline <style> element,
 * which the Content Security Policy (rightly) blocks.
 */
export function MenuRoot(props: ComponentProps<typeof DropdownMenu.Root>) {
  return <DropdownMenu.Root modal={false} {...props} />;
}
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuContent({ className, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={6}
        align="end"
        className={cn(
          "z-50 min-w-40 rounded-xl border border-line bg-surface p-1 text-fg shadow-pop",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-2 data-[state=checked]:text-accent-text",
        className,
      )}
      {...props}
    >
      {children}
    </DropdownMenu.RadioItem>
  );
}
