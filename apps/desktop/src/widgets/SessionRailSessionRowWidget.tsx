/**
 * Stateful wrapper for one session rail row: wires the row's action menu.
 *
 * Two shadcn (Radix) menus share one item list: a DropdownMenu opened from
 * the row's ⋯ chip, and a ContextMenu opened by right-click (the keyboard
 * menu key / Shift+F10 arrive as `contextmenu` too). Both contents render
 * beside the row in the React tree — not inside it — so clicks and keys on
 * a menu item never bubble into the row's select / keyboard handlers.
 *
 * The ContextMenu trigger is a `display: contents` host around the row
 * (`sess-row-host`), so the row view stays a plain stateless component and
 * the list layout is unchanged. Right-click is disabled while renaming so
 * the rename field keeps the OS edit menu (cut / copy / paste).
 *
 * Local state only (high-frequency UI, never in a store): whether either
 * menu is open, and a parked pick — Rename / Delete move focus, so they
 * run from `onCloseAutoFocus` once the modal menu has released its focus
 * trap, not from `onSelect`.
 */

import { memo, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { railSessionTitle } from "@/lib/sessionTitleEdit";
import {
  SessionRailSessionMenuButtonView,
  SessionRailSessionMenuItemsView,
} from "./SessionRailSessionMenuView";
import {
  SessionRailSessionRowView,
  type SessionRailSessionRowProps,
} from "./SessionRailSessionRowView";

/** Props for {@link SessionRailSessionRowWidget}. */
export type SessionRailSessionRowWidgetProps = Omit<
  SessionRailSessionRowProps,
  "menuOpen" | "menuButton"
> & {
  /**
   * Toggle pin for this session only (within its workspace; does not pin
   * or float the project folder). Runs from the menu.
   */
  onTogglePin: () => void;
  /** Delete this session (the rail hook routes it through the confirm). */
  onRemove: () => void;
  /**
   * Remove the worktree after the shell confirms. Missing hides the menu
   * row (the chat is not in a worktree, or no confirm hook is wired).
   */
  onRemoveWorktree?: () => void;
};

/**
 * Session row + its ⋯ / right-click menus (Rename / Pin / Delete…).
 * Wrapped in React.memo like the view so unchanged rows skip re-render.
 * @param props Row view props plus the pin / delete handlers the menu runs.
 * @returns The row inside its ContextMenu trigger, plus both menu contents
 *   (portaled by Radix while open).
 */
function SessionRailSessionRowWidgetInner(
  props: SessionRailSessionRowWidgetProps,
) {
  const { onTogglePin, onRemove, onRemoveWorktree, ...rowProps } = props;
  const { rec, pinned, editing = false, onBeginRename } = rowProps;
  /** Rail title; names the ⋯ chip and the right-click menu. */
  const titleLabel = railSessionTitle(rec);
  /** ⋯ menu open (Radix `onOpenChange`). */
  const [dropdownOpen, setDropdownOpen] = useState(false);
  /** Right-click menu open (Radix `onOpenChange`). */
  const [contextOpen, setContextOpen] = useState(false);
  /**
   * A pick that moves focus (rename field, delete confirm), parked until
   * the menu is gone. The modal menu keeps its focus trap while it animates
   * out, so focus moved during `onSelect` is pulled back into the closing
   * menu and lands on `<body>` when it unmounts. `skipFocusReturn`: the
   * action focuses something itself, so Radix must not refocus the opener.
   */
  const pendingPickRef = useRef<{
    run: () => void;
    skipFocusReturn: boolean;
  } | null>(null);

  /** Rename after close; the title field takes focus. Absent without a handler. */
  const handleRename = onBeginRename
    ? () => {
        pendingPickRef.current = { run: onBeginRename, skipFocusReturn: true };
      }
    : undefined;

  /**
   * Delete after close, once focus is back on the opener: the confirm
   * dialog remembers that element and returns focus to it on Cancel.
   */
  const handleRemove = () => {
    pendingPickRef.current = { run: onRemove, skipFocusReturn: false };
  };

  /**
   * Remove worktree after the menu releases focus, same as Delete, so the
   * confirm dialog can restore focus to the opener on dismiss.
   */
  const handleRemoveWorktree = onRemoveWorktree
    ? () => {
        pendingPickRef.current = {
          run: onRemoveWorktree,
          skipFocusReturn: false,
        };
      }
    : undefined;

  /**
   * Radix close-focus hook shared by both menus. Fires after the closed
   * menu unmounted and released its trap — the first moment a parked pick
   * can move focus and keep it. With nothing parked, Radix restores focus
   * as usual (⋯ chip, or the prior focus after right-click).
   * @param event Radix `onCloseAutoFocus`; preventDefault skips Radix's
   *   own focus return.
   */
  const handleCloseAutoFocus = (event: Event) => {
    const pending = pendingPickRef.current;
    if (!pending) {
      return;
    }
    pendingPickRef.current = null;
    if (pending.skipFocusReturn) {
      event.preventDefault();
    }
    // Delete's confirm renders after Radix's synchronous refocus (this runs
    // outside a React event, so the state update is batched to later).
    pending.run();
  };

  return (
    <DropdownMenu onOpenChange={setDropdownOpen}>
      <ContextMenu onOpenChange={setContextOpen}>
        <ContextMenuTrigger asChild disabled={editing}>
          <div className="sess-row-host">
            <SessionRailSessionRowView
              {...rowProps}
              menuOpen={dropdownOpen || contextOpen}
              menuButton={
                <SessionRailSessionMenuButtonView titleLabel={titleLabel} />
              }
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          aria-label={`Actions for ${titleLabel}`}
          onCloseAutoFocus={handleCloseAutoFocus}
        >
          <SessionRailSessionMenuItemsView
            kind="context"
            pinned={pinned}
            onRename={handleRename}
            onTogglePin={onTogglePin}
            onRemove={handleRemove}
            onRemoveWorktree={handleRemoveWorktree}
          />
        </ContextMenuContent>
      </ContextMenu>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        <SessionRailSessionMenuItemsView
          kind="dropdown"
          pinned={pinned}
          onRename={handleRename}
          onTogglePin={onTogglePin}
          onRemove={handleRemove}
          onRemoveWorktree={handleRemoveWorktree}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Memoized rail row widget — skips re-render when catalog identity churns elsewhere. */
export const SessionRailSessionRowWidget = memo(SessionRailSessionRowWidgetInner);
SessionRailSessionRowWidget.displayName = "SessionRailSessionRowWidget";
