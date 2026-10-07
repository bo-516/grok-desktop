/**
 * Session rail row menu pieces on the shadcn (Radix) menu primitives.
 *
 * - {@link SessionRailSessionMenuButtonView}: the row's ⋯ chip, a
 *   DropdownMenu trigger (renders inside the row's trailing slot).
 * - {@link SessionRailSessionMenuItemsView}: Rename, Pin / Unpin, Delete…
 *   — one list rendered into either the DropdownMenu (⋯) or the
 *   ContextMenu (right-click), so both menus always match.
 *
 * Delete sits below a separator in danger ink and ends in "…" because the
 * shell confirms it before anything is removed (when a confirm hook is
 * wired). The row widget owns the menu roots and open state.
 */

import { Ellipsis, PencilLine, Pin, PinOff, Trash2 } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Which Radix menu the item list renders into. */
export type SessionRowMenuKind = "dropdown" | "context";

/** Props for {@link SessionRailSessionMenuItemsView}. */
export type SessionRailSessionMenuItemsViewProps = {
  /** `dropdown` (⋯ chip) or `context` (right-click); picks the primitives. */
  kind: SessionRowMenuKind;
  /** Current pin state — picks "Pin to top" vs "Unpin". */
  pinned: boolean;
  /** Swap the title for the inline field. Missing hides the Rename row. */
  onRename?: () => void;
  /** Toggle this chat's pin within its project. */
  onTogglePin: () => void;
  /** Delete (through the shell's confirm when wired). */
  onRemove: () => void;
};

/**
 * The row's ⋯ chip as a DropdownMenu trigger. Radix opens on pointerdown
 * and sets `aria-haspopup` / `aria-expanded` / `data-state`; the click
 * that follows is stopped so opening the menu never also selects the chat.
 * Must render inside the row widget's `DropdownMenu` root.
 * @param props `titleLabel` — rail title, names the chip for screen readers.
 * @returns Trigger button styled by `sess-menu-btn`.
 */
export function SessionRailSessionMenuButtonView(props: {
  titleLabel: string;
}) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="sess-menu-btn"
        aria-label={`Actions for ${props.titleLabel}`}
        onClick={(e) => e.stopPropagation()}
      >
        <Ellipsis
          className="sess-menu-icon"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>
    </DropdownMenuTrigger>
  );
}

/**
 * Rename / Pin / Delete rows for one chat. Radix runs `onSelect` and then
 * closes the menu; glyph size and ink come from the primitives' row class.
 * @param props Menu kind, pin state, and the three row actions.
 * @returns Menu rows (no surface — the caller's Content provides it).
 */
export function SessionRailSessionMenuItemsView(
  props: SessionRailSessionMenuItemsViewProps,
) {
  const { kind, pinned, onRename, onTogglePin, onRemove } = props;
  /** Row primitive for this menu kind (same props on both). */
  const Item = kind === "dropdown" ? DropdownMenuItem : ContextMenuItem;
  /** Separator primitive for this menu kind. */
  const Separator =
    kind === "dropdown" ? DropdownMenuSeparator : ContextMenuSeparator;
  /** Glyph for the pin row: the action it performs, not the current state. */
  const PinGlyph = pinned ? PinOff : Pin;
  return (
    <>
      {onRename ? (
        <Item onSelect={onRename}>
          <PencilLine strokeWidth={1.75} aria-hidden="true" />
          Rename
        </Item>
      ) : null}
      <Item onSelect={onTogglePin}>
        <PinGlyph strokeWidth={1.75} aria-hidden="true" />
        {pinned ? "Unpin" : "Pin to top"}
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={onRemove}>
        <Trash2 strokeWidth={1.75} aria-hidden="true" />
        Delete…
      </Item>
    </>
  );
}
