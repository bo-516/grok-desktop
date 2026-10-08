/**
 * shadcn/ui Tabs (Radix) with app-token chrome.
 *
 * Purpose: a tab strip whose triggers switch one visible panel, with Radix
 * handling roving focus (← / →), `aria-selected` / `aria-controls` wiring and
 * activation. First consumer: the terminal dock's tab bar.
 *
 * Source: `npx shadcn@latest add tabs` (new-york), hand-copied (the CLI is
 * not run in this repo). Behavior and exports follow upstream; shadcn's
 * stone colors are bridged to app tokens (`bg-white-*`, `text-fg*`,
 * `--color-focus-ring`). Sizes are px because the html root is 13px.
 */

import { Tabs as TabsPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Root: owns the selected value. Controlled with `value` + `onValueChange`,
 * or uncontrolled with `defaultValue`.
 * @param props Radix Root props; `className` extends the flex column default.
 * @returns The tabs container.
 */
function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

/**
 * The tablist row. Children are TabsTrigger elements (other buttons may sit
 * beside them; they simply are not part of the arrow-key roving group).
 * @param props Radix List props; `className` overrides the defaults.
 * @returns `role="tablist"` row.
 */
function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-8 w-fit items-center justify-center rounded-8px bg-white-faint p-0.5 text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}

/**
 * One tab button; `value` must match a TabsContent `value`.
 * @param props Radix Trigger props; `className` overrides the defaults.
 * @returns `role="tab"` button with `data-state="active|inactive"`.
 */
function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-6px border border-transparent bg-transparent px-2 py-1 text-12px font-medium whitespace-nowrap text-fg-muted transition-colors duration-fast ease-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-white-soft data-[state=active]:text-fg [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Panel shown for the matching trigger. Pass `forceMount` to keep inactive
 * panels mounted (state such as a terminal's scrollback survives); hide them
 * with `data-[state=inactive]:hidden` in that case.
 * @param props Radix Content props; `className` overrides the defaults.
 * @returns `role="tabpanel"` container.
 */
function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
