/**
 * Session rail workspace menu — pure presentation.
 * Density quota + grok-build chip; menu opens upward above the footer.
 * Parent owns open state, item list, and action handlers.
 * When open, the quota is paint-suppressed so the light density track cannot
 * show under the popover bottom edge (anchor layout is kept).
 */

import cs from "classnames";
import { useEffect, useRef, type CSSProperties } from "react";
import { SessionRailFooterLiveStatus } from "./SessionRailSessionRowView";

/** Workspace / app-level actions from the side-nav footer chip (no session-scoped items). */
export type WorkspaceMenuActionId =
  | "settings"
  | "overview"
  | "environment"
  | "reconnect";

export type WorkspaceMenuItem = {
  /** Stable id for onSelect. */
  id: WorkspaceMenuActionId;
  /** Visible label. */
  label: string;
  /** Optional secondary hint (shortcut, status). */
  hint?: string;
  /** Optional count badge (e.g. streaming tasks). */
  badge?: number;
  /** Draw a separator line above this row. */
  separatorBefore?: boolean;
};

export type SessionRailWorkspaceMenuViewProps = {
  /** Whether the popover is open. */
  open: boolean;
  /** Toggle open from the user chip. */
  onToggle: () => void;
  /** Close without action (outside click / Escape). */
  onClose: () => void;
  /** Run a menu item then typically close. */
  onSelect: (id: WorkspaceMenuActionId) => void;
  /** Menu rows to show. */
  items: WorkspaceMenuItem[];
  /** True when connectionMode is live-bridge. */
  live: boolean;
  /** Footer "N running" count (streaming sessions). */
  liveCount: number;
  /**
   * Sessions currently streaming — badge on the trigger and Overview row
   * (cross-session pool count; matches Overview's data scope).
   */
  streamingCount: number;
  /** Catalog size for the density bar and "Sessions" label. */
  catalogLength: number;
};

/**
 * Badge or keyboard hint on a workspace menu row (mutually exclusive).
 * @param props item Menu row with optional badge / hint.
 * @returns Trailing badge, hint span, or null.
 */
function WorkspaceMenuItemTrailing(props: { item: WorkspaceMenuItem }) {
  const { item } = props;
  if (item.badge != null && item.badge > 0) {
    return (
      <span className="side-nav-nav-badge" aria-hidden="true">
        {item.badge}
      </span>
    );
  }
  if (item.hint) {
    return (
      <span className="side-nav-workspace-menu-hint">{item.hint}</span>
    );
  }
  return null;
}

/**
 * Renders sessions density cue, footer user chip, and upward workspace menu.
 * @param props open/onToggle/onClose/onSelect/items + live status + catalog —
 *   missing onClose leaves the menu stuck open on outside click.
 * @returns Quota row + user chip trigger + optional menu list.
 */
export function SessionRailWorkspaceMenuView(
  props: SessionRailWorkspaceMenuViewProps,
) {
  const {
    open,
    onClose,
    onToggle,
    onSelect,
    items,
    live,
    liveCount,
    streamingCount,
    catalogLength,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);

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
    <>
      <div
        className={cs("side-nav-quota", {
          "side-nav-quota-suppressed": open,
        })}
        title="Local session count"
        aria-hidden={open || undefined}
      >
        <span className="side-nav-quota-label">Sessions</span>
        <span className="side-nav-quota-value">{catalogLength}</span>
        <div className="side-nav-quota-track" aria-hidden="true">
          <div
            className="side-nav-quota-fill"
            style={
              {
                /* width only — catalog density cue, not a color token */
                width: `${Math.min(100, Math.max(8, catalogLength * 8))}%`,
              } satisfies CSSProperties
            }
          />
        </div>
      </div>

      <div className="side-nav-workspace-menu" ref={rootRef}>
        <button
          type="button"
          className={cs("side-nav-user group", {
            "side-nav-user-open": open,
          })}
          title={
            live
              ? "Workspace menu — settings, overview, reconnect"
              : "Workspace menu — connect and restore"
          }
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Workspace menu"
          onClick={onToggle}
        >
          <span className="side-nav-avatar" aria-hidden="true">
            G
          </span>
          <span className="side-nav-user-meta">
            <span className="side-nav-user-name">grok-build</span>
            <span className="side-nav-user-status">
              <SessionRailFooterLiveStatus live={live} liveCount={liveCount} />
            </span>
          </span>
          {streamingCount > 0 ? (
            <span className="side-nav-nav-badge" aria-hidden="true">
              {streamingCount}
            </span>
          ) : null}
          <span className="side-nav-user-action" aria-hidden="true">
            ⋯
          </span>
        </button>

        {open ? (
          <ul
            className="side-nav-workspace-menu-list"
            role="menu"
            aria-label="Workspace"
          >
            {items.map((item) => (
              <li key={item.id} role="none">
                {item.separatorBefore ? (
                  <div
                    className="side-nav-workspace-menu-sep"
                    role="separator"
                  />
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className="side-nav-workspace-menu-item"
                  onClick={() => onSelect(item.id)}
                >
                  <span className="side-nav-workspace-menu-label">
                    {item.label}
                  </span>
                  <WorkspaceMenuItemTrailing item={item} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}
