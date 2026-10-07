/**
 * shadcn/ui ContextMenu (Radix) with app-token chrome.
 *
 * Purpose: right-click menus. The trigger wraps the element that owns the
 * menu (a rail project header, a session row); Radix opens the content at
 * the pointer, keeps it on screen, and handles keyboard navigation,
 * typeahead, dismissal, and focus return.
 *
 * Source: `npx shadcn@latest add context-menu` (new-york). Behavior and
 * exports follow upstream; classes are bridged to app tokens through
 * `./menu-classes`, shared with `dropdown-menu.tsx`.
 *
 * Boundary: Radix opens only when the trigger's `contextmenu` event reaches
 * React with `defaultPrevented` still false. The WebView menu suppressor
 * (`@/lib/suppressBrowserContextMenu`) therefore runs in the bubble phase,
 * after React has handled the event.
 */

import { Check, ChevronRight, Circle } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
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
 * Root of one trigger + content pair. Radix owns the open state;
 * `onOpenChange` reports it.
 * @param props Radix Root props (`onOpenChange`, `modal`, `dir`).
 * @returns Context provider only — renders no DOM of its own.
 */
function ContextMenu(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

/**
 * Area whose right-click (or long-press / ContextMenu key) opens the menu.
 * Pass `asChild` to reuse the owner's element instead of adding a `<span>`
 * to the layout.
 * @param props Radix Trigger props. `disabled` keeps the menu closed (the
 *   WebView suppressor still hides the browser menu).
 * @returns The trigger element.
 */
function ContextMenuTrigger(
  props: ComponentProps<typeof ContextMenuPrimitive.Trigger>,
) {
  return (
    <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
  );
}

/**
 * Groups related rows for assistive tech (no visual chrome).
 * @param props Radix Group props.
 * @returns `role="group"` wrapper.
 */
function ContextMenuGroup(
  props: ComponentProps<typeof ContextMenuPrimitive.Group>,
) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}

/**
 * Portals children into `document.body` (or `container`). Content already
 * portals itself; use this only for custom surfaces.
 * @param props Radix Portal props.
 * @returns Portal.
 */
function ContextMenuPortal(
  props: ComponentProps<typeof ContextMenuPrimitive.Portal>,
) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  );
}

/**
 * Nested sub-menu root (pairs a SubTrigger with a SubContent).
 * @param props Radix Sub props (`open`, `onOpenChange`).
 * @returns Context provider only.
 */
function ContextMenuSub(props: ComponentProps<typeof ContextMenuPrimitive.Sub>) {
  return <ContextMenuPrimitive.Sub data-slot="context-menu-sub" {...props} />;
}

/**
 * Single-choice group for radio rows.
 * @param props Radix RadioGroup props (`value`, `onValueChange`).
 * @returns `role="group"` wrapper.
 */
function ContextMenuRadioGroup(
  props: ComponentProps<typeof ContextMenuPrimitive.RadioGroup>,
) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}

/**
 * Row that opens a sub-menu; stays filled while the sub-menu is open.
 * @param props Radix SubTrigger props plus `inset` (indent to line up with
 *   checkbox / radio labels). Children are the row label.
 * @returns Row with a trailing chevron.
 */
function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset || undefined}
      className={cn(MENU_ROW_CLASS, MENU_SUB_TRIGGER_OPEN_CLASS, className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  );
}

/**
 * Floating panel of a sub-menu (same surface as the root content).
 * @param props Radix SubContent props; `className` overrides defaults.
 * @returns Sub-menu surface.
 */
function ContextMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.SubContent
      data-slot="context-menu-sub-content"
      className={cn(
        MENU_SURFACE_CLASS,
        "origin-[var(--radix-context-menu-content-transform-origin)]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Menu panel, portaled to `document.body` so scroll containers cannot clip
 * it and sticky headers cannot paint over it. Height is capped by the
 * viewport room Radix measured, and the panel scrolls past that.
 * @param props Radix Content props; `className` overrides defaults.
 * @returns Portaled menu surface.
 */
function ContextMenuContent({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          MENU_SURFACE_CLASS,
          "max-h-[min(70vh,420px,var(--radix-context-menu-content-available-height))] origin-[var(--radix-context-menu-content-transform-origin)]",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
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
function ContextMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
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
function ContextMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      className={cn(MENU_ROW_CLASS, MENU_CHECK_ROW_CLASS, className)}
      {...props}
    >
      <span className={MENU_INDICATOR_CLASS}>
        <ContextMenuPrimitive.ItemIndicator>
          <Check />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  );
}

/**
 * Single-choice row with a dot in the left gutter; must sit inside a
 * {@link ContextMenuRadioGroup}.
 * @param props Radix RadioItem props (`value`).
 * @returns `role="menuitemradio"` row.
 */
function ContextMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.RadioItem>) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(MENU_ROW_CLASS, MENU_CHECK_ROW_CLASS, className)}
      {...props}
    >
      <span className={MENU_INDICATOR_CLASS}>
        <ContextMenuPrimitive.ItemIndicator>
          <Circle className="fill-current" />
        </ContextMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  );
}

/**
 * Non-interactive section heading.
 * @param props Radix Label props plus `inset` (indent).
 * @returns Muted heading row.
 */
function ContextMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Label
      data-slot="context-menu-label"
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
function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
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
function ContextMenuShortcut({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(MENU_SHORTCUT_CLASS, className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
};
