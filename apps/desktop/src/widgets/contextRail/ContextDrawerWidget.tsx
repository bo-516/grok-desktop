/**
 * Full-height non-modal plan companion drawer (always mounted).
 * Chrome owns open/close, layout preference footer, and Escape;
 * PlanPanelView is display-only body content.
 */

import type { PlanEntry } from "@grok-desktop/acp-core";
import cs from "classnames";
import { X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import type { DrawerLayout } from "@/lib/contextDrawerPrefs";
import { PlanPanelView } from "../PlanPanelView";

export type ContextDrawerWidgetProps = {
  /** Whether the drawer is slid in (still mounted when false). */
  open: boolean;
  /** Plan entries from the live session; empty still shows empty state. */
  plan: PlanEntry[] | undefined;
  /**
   * Effective layout after narrow-window clamp (drives shadow + push chrome).
   * When "overlay", drawer paints shadow-modal; push mode is flush.
   */
  effectiveLayout: DrawerLayout;
  /**
   * User preference for push (true) vs overlay (false).
   * Distinct from effectiveLayout when the viewport is too narrow.
   */
  pushPreferred: boolean;
  /**
   * True when the window is below the push min-width so push is clamped off.
   * Surfaces a short explanation on the checkbox description.
   */
  layoutClamped: boolean;
  /** Close the drawer (user dismiss — shell remembers for auto-open). */
  onClose: () => void;
  /**
   * Persist layout preference when the user toggles the footer checkbox.
   * @param layout Next preferred layout (push | overlay).
   */
  onLayoutChange: (layout: DrawerLayout) => void;
};

/**
 * Always-mounted right drawer with head chrome, plan body, and layout footer.
 * Closed state uses inert + off-screen translate so exit motion and aria-controls work.
 * @param props Open flag, plan data, layout prefs, and close/change handlers.
 * @returns Aside with id=context-rail for aria-controls from the top-nav toggle.
 */
export function ContextDrawerWidget(props: ContextDrawerWidgetProps) {
  const count = props.plan?.length ?? 0;
  const isOverlay = props.effectiveLayout === "overlay";

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") {
      return;
    }
    if (!props.open) {
      return;
    }
    e.stopPropagation();
    props.onClose();
  };

  return (
    <aside
      id="context-rail"
      className={cs("context-drawer", {
        "context-drawer-open": props.open,
        "context-drawer-closed": !props.open,
        "context-drawer-overlay": isOverlay,
      })}
      aria-label="Context"
      inert={!props.open ? true : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="context-drawer-head">
        <h2 className="context-drawer-title">
          <span>Plan</span>
          {count > 0 ? (
            <span
              className="context-drawer-count"
              aria-label={`${count} steps`}
            >
              {count}
            </span>
          ) : null}
        </h2>
        <button
          type="button"
          className="context-drawer-close"
          onClick={props.onClose}
          aria-label="Close plan rail"
          title="Close"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="context-drawer-body">
        <PlanPanelView entries={props.plan} />
      </div>
      <div className="context-drawer-footer">
        <Checkbox
          id="context-drawer-push"
          checked={props.pushPreferred}
          onChange={(e) =>
            props.onLayoutChange(e.target.checked ? "push" : "overlay")
          }
          label="Push content when open"
          description={
            props.layoutClamped
              ? "Overlaying — window too narrow to push"
              : "Applies to all sessions"
          }
        />
      </div>
    </aside>
  );
}
