/**
 * Session overflow menu (⋯) — pure presentation.
 * Parent owns open state, item list, and action handlers.
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
  /** Optional secondary hint (slash name, shortcut). */
  hint?: string;
  /** Danger styling for destructive ops. */
  danger?: boolean;
};

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
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        props.onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [props.open, props.onClose]);

  return (
    <div className="top-nav-menu" ref={rootRef}>
      <button
        type="button"
        className={cs("top-nav-icon-btn", {
          "top-nav-link-active": props.open,
        })}
        title="Session actions"
        aria-haspopup="menu"
        aria-expanded={props.open}
        onClick={props.onToggle}
      >
        ⋯
      </button>
      {props.open ? (
        <ul className="top-nav-menu-list" role="menu" aria-label="Session actions">
          {props.items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={cs("top-nav-menu-item", {
                  "top-nav-menu-item-danger": Boolean(item.danger),
                })}
                onClick={() => props.onSelect(item.id)}
              >
                <span className="top-nav-menu-label">{item.label}</span>
                {item.hint ? (
                  <span className="top-nav-menu-hint">{item.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
