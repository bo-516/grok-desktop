/**
 * Session overflow menu (⋯) — pure presentation.
 * Parent owns open state, item list, and action handlers.
 * Shortcut hints (⌘N) are split onto `top-nav-menu-kbd` so the modifier
 * is not jammed against the key; slash / status hints stay mono.
 * Selecting a row focuses the trigger before the list unmounts so the
 * browser does not scroll a removed menuitem into view.
 * Wrong handlers (e.g. rewind without confirm) are caller bugs, not this view.
 */

import cs from "classnames";
import { useEffect, useRef } from "react";

/** Session ⋯ action ids (session ops + narrow-viewport fallbacks). */
export type SessionMenuActionId =
  | "fork"
  | "rewind"
  | "sync"
  | "copy_id"
  | "delete"
  | "new_chat"
  | "palette";

export type SessionMenuItem = {
  /** Stable id for onSelect. */
  id: SessionMenuActionId;
  /** Visible label. */
  label: string;
  /** Optional secondary hint (slash name, shortcut chord). */
  hint?: string;
  /** Danger styling for destructive ops. */
  danger?: boolean;
};

/** Leading modifier run (⌘⌥⌃⇧) vs the rest of a shortcut hint. */
const SHORTCUT_HINT = /^([⌘⌥⌃⇧]+)(.+)$/u;

/**
 * Trailing menu hint. Slash / status copy stays mono. Shortcut chords
 * (⌘N) switch to the UI sans and insert a gap so the modifier does not
 * read as a hash jammed against the key.
 * @param props.hint Visible hint; empty is the caller's job (do not render).
 */
function SessionMenuHintView(props: { hint: string }) {
  const { hint } = props;
  const parts = SHORTCUT_HINT.exec(hint);
  if (parts?.[1] && parts[2]) {
    return (
      <span className="top-nav-menu-kbd">
        <span>{parts[1]}</span>
        <span>{parts[2]}</span>
      </span>
    );
  }
  return <span className="top-nav-menu-hint">{hint}</span>;
}

export type SessionActionsMenuViewProps = {
  /** Whether the popover is open. */
  open: boolean;
  /** Toggle open from the ⋯ trigger. */
  onToggle: () => void;
  /** Close without action (outside click / Escape). */
  onClose: () => void;
  /** Run a menu item then typically close. */
  onSelect: (id: SessionMenuActionId) => void;
  /** Menu rows to show. */
  items: SessionMenuItem[];
};

/**
 * Renders a top-nav ⋯ button and anchored menu of session actions.
 * @param props open/onToggle/onClose/onSelect/items — missing onClose leaves the menu stuck open on outside click
 * @returns Fragment with trigger + optional menu
 */
export function SessionActionsMenuView(props: SessionActionsMenuViewProps) {
  const { open, onClose, onToggle, onSelect, items } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /**
   * Dispatch a row then let the parent close the list.
   * Focus returns to the ⋯ trigger first so unmounting the focused menuitem
   * cannot scroll a removed node into view (that jump reads as a page shake).
   * @param id Menu action id; forwarded unchanged to onSelect.
   */
  const pickItem = (id: SessionMenuActionId) => {
    triggerRef.current?.focus({ preventScroll: true });
    onSelect(id);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className="top-nav-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cs("top-nav-icon-btn", {
          "top-nav-link-active": open,
        })}
        title="Session actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        ⋯
      </button>
      {open ? (
        <ul className="top-nav-menu-list" role="menu" aria-label="Session actions">
          {items.map((item) => (
            <li key={item.id} role="none" className="top-nav-menu-row">
              <button
                type="button"
                role="menuitem"
                className={cs("top-nav-menu-item", {
                  "top-nav-menu-item-danger": Boolean(item.danger),
                })}
                onClick={() => pickItem(item.id)}
              >
                <span className="top-nav-menu-label">{item.label}</span>
                {item.hint ? <SessionMenuHintView hint={item.hint} /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
