import { DropdownMenu } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn";

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

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: a menu group heading, rendered as a div, not a form label
    <DropdownMenu.Label
      className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted", className)}
      {...props}
    />
  );
}

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:text-muted",
        className,
      )}
      {...props}
    />
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
