/**
 * shadcn/ui DropdownMenu (Radix) with app-token chrome.
 *
 * Purpose: menus opened from a button (a ⋯ chip, an overflow control).
 * Radix anchors the content to the trigger, flips it to stay on screen,
 * and handles keyboard navigation, typeahead, dismissal, and focus return.
 *
 * Source: `npx shadcn@latest add dropdown-menu` (new-york). Behavior and
 * exports follow upstream; classes are bridged to app tokens through
 * `./menu-classes`, shared with `context-menu.tsx`.
 */

import { Check, ChevronRight, Circle } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import {
  MENU_CHECK_ROW_CLASS,
  MENU_INDICATOR_CLASS,
  MENU_LABEL_CLASS,
  MENU_ROW_CLASS,
  MENU_ROW_DESTRUCTIVE_CLASS,
  MENU_SEPARATOR_CLASS,
  MENU_SHORTCUT_CLASS,
  MENU_SUB_TRIGGER_OPEN_CLASS,
  MENU_SURFACE_CLASS,
} from "./menu-classes";

/**
 * Root of one trigger + content pair. Uncontrolled by default; pass
 * `open` + `onOpenChange` to control it.
 * @param props Radix Root props (`open`, `defaultOpen`, `onOpenChange`,
 *   `modal`).
 * @returns Context provider only — renders no DOM of its own.
 */
function DropdownMenu(
  props: ComponentProps<typeof DropdownMenuPrimitive.Root>,
) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/**
 * Portals children into `document.body` (or `container`). Content already
 * portals itself; use this only for custom surfaces.
 * @param props Radix Portal props.
 * @returns Portal.
 */
function DropdownMenuPortal(
  props: ComponentProps<typeof DropdownMenuPrimitive.Portal>,
) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  );
}

/**
 * Button that toggles the menu. Pass `asChild` to reuse an existing
 * button (keeps its classes and ref).
 * @param props Radix Trigger props.
 * @returns The trigger button with `aria-expanded` / `data-state`.
 */
function DropdownMenuTrigger(
  props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>,
) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  );
}

/**
 * Menu panel, portaled to `document.body` so scroll containers cannot clip
 * it and sticky headers cannot paint over it. Height is capped by the
 * viewport room Radix measured, and the panel scrolls past that.
 * @param props Radix Content props; `sideOffset` (px gap from the trigger)
 *   defaults to 4, and `className` overrides defaults.
 * @returns Portaled menu surface.
 */
function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          MENU_SURFACE_CLASS,
          "max-h-[min(70vh,420px,var(--radix-dropdown-menu-content-available-height))] origin-[var(--radix-dropdown-menu-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

/**
 * Groups related rows for assistive tech (no visual chrome).
 * @param props Radix Group props.
 * @returns `role="group"` wrapper.
 */
function DropdownMenuGroup(
  props: ComponentProps<typeof DropdownMenuPrimitive.Group>,
) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  );
}

/**
 * Actionable row. Run the action from `onSelect`; Radix closes the menu
 * afterwards unless the handler calls `event.preventDefault()`.
 * @param props Radix Item props plus `inset` (indent) and `variant`
 *   (`"destructive"` paints Delete / Remove rows in danger ink). `disabled`
 *   dims the row and skips it in keyboard navigation.
 * @returns `role="menuitem"` row.
 */
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset || undefined}
      data-variant={variant}
      className={cn(MENU_ROW_CLASS, MENU_ROW_DESTRUCTIVE_CLASS, className)}
      {...props}
    />
  );
}

/**
 * Toggle row with a check mark in the left gutter.
 * @param props Radix CheckboxItem props (`checked`, `onCheckedChange`).
 * @returns `role="menuitemcheckbox"` row.
 */
function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(MENU_ROW_CLASS, MENU_CHECK_ROW_CLASS, className)}
      {...props}
    >
      <span className={MENU_INDICATOR_CLASS}>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

/**
 * Single-choice group for radio rows.
 * @param props Radix RadioGroup props (`value`, `onValueChange`).
 * @returns `role="group"` wrapper.
 */
function DropdownMenuRadioGroup(
  props: ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>,
) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

/**
 * Single-choice row with a dot in the left gutter; must sit inside a
 * {@link DropdownMenuRadioGroup}.
 * @param props Radix RadioItem props (`value`).
 * @returns `role="menuitemradio"` row.
 */
function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(MENU_ROW_CLASS, MENU_CHECK_ROW_CLASS, className)}
      {...props}
    >
      <span className={MENU_INDICATOR_CLASS}>
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

/**
 * Non-interactive section heading.
 * @param props Radix Label props plus `inset` (indent).
 * @returns Muted heading row.
 */
function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset || undefined}
      className={cn(MENU_LABEL_CLASS, className)}
      {...props}
    />
  );
}

/**
 * Hairline between row groups.
 * @param props Radix Separator props.
 * @returns `role="separator"` rule.
 */
function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn(MENU_SEPARATOR_CLASS, className)}
      {...props}
    />
  );
}

/**
 * Trailing keyboard hint inside a row (display only; does not bind keys).
 * @param props Span props; children are the hint text.
 * @returns Right-aligned muted hint.
 */
function DropdownMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(MENU_SHORTCUT_CLASS, className)}
      {...props}
    />
  );
}

/**
 * Nested sub-menu root (pairs a SubTrigger with a SubContent).
 * @param props Radix Sub props (`open`, `onOpenChange`).
 * @returns Context provider only.
 */
function DropdownMenuSub(
  props: ComponentProps<typeof DropdownMenuPrimitive.Sub>,
) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

/**
 * Row that opens a sub-menu; stays filled while the sub-menu is open.
 * @param props Radix SubTrigger props plus `inset` (indent). Children are
 *   the row label.
 * @returns Row with a trailing chevron.
 */
function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset || undefined}
      className={cn(MENU_ROW_CLASS, MENU_SUB_TRIGGER_OPEN_CLASS, className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

/**
 * Floating panel of a sub-menu (same surface as the root content).
 * @param props Radix SubContent props; `className` overrides defaults.
 * @returns Sub-menu surface.
 */
function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        MENU_SURFACE_CLASS,
        "origin-[var(--radix-dropdown-menu-content-transform-origin)]",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
