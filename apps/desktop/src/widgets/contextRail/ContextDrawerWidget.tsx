/**
 * Full-height non-modal session companion drawer (always mounted).
 * Chrome owns open/close, Plan | Agents tabs, layout preference footer, and Escape.
 * Body content is PlanPanelView or AgentsRailWidget by active tab.
 */

import type { PlanEntry } from "@grok-desktop/acp-core";
import cs from "classnames";
import { X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import type { DrawerLayout } from "@/lib/contextDrawerPrefs";
import type { ContextRailId } from "@/widgets/shell/shellPanels";
import { AgentsRailWidget } from "@/widgets/agentsRail";
import { PlanPanelView } from "../PlanPanelView";

export type ContextDrawerWidgetProps = {
  /** Whether the drawer is slid in (still mounted when false). */
  open: boolean;
  /**
   * Which session surface is active: plan checklist or agents list.
   * Preview uses its own drawer; this chrome is shared by plan + agents only.
   */
  rail: Extract<ContextRailId, "plan" | "agents"> | null;
  /** Plan entries from the live session; empty still shows empty state. */
  plan: PlanEntry[] | undefined;
  /** Running subagent count for the Agents tab badge (current session only). */
  runningSubagents: number;
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
   * Switch between Plan and Agents without closing the drawer.
   * @param next Tab the user selected.
   */
  onSelectTab: (next: "plan" | "agents") => void;
  /**
   * Persist layout preference when the user toggles the footer checkbox.
   * @param layout Next preferred layout (push | overlay).
   */
  onLayoutChange: (layout: DrawerLayout) => void;
};

/**
 * Always-mounted right drawer with Plan|Agents tabs, body, and layout footer.
 * Closed state uses inert + off-screen translate so exit motion and aria-controls work.
 * @param props Open flag, rail tab, plan/agents data, layout prefs, handlers.
 * @returns Aside with id=context-rail for aria-controls from the top-nav toggle.
 */
export function ContextDrawerWidget(props: ContextDrawerWidgetProps) {
  const planCount = props.plan?.length ?? 0;
  const isOverlay = props.effectiveLayout === "overlay";
  const activeTab: "plan" | "agents" =
    props.rail === "agents" ? "agents" : "plan";

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
        <div className="context-drawer-tabs" role="tablist" aria-label="Session rail">
          <button
            type="button"
            role="tab"
            className={cs("context-drawer-tab", {
              "context-drawer-tab-active": activeTab === "plan",
            })}
            aria-selected={activeTab === "plan"}
            onClick={() => props.onSelectTab("plan")}
          >
            Plan
            {planCount > 0 ? (
              <span
                className="context-drawer-count"
                aria-label={`${planCount} steps`}
              >
                {planCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            role="tab"
            className={cs("context-drawer-tab", {
              "context-drawer-tab-active": activeTab === "agents",
            })}
            aria-selected={activeTab === "agents"}
            onClick={() => props.onSelectTab("agents")}
          >
            Agents
            {props.runningSubagents > 0 ? (
              <span
                className="context-drawer-count"
                aria-label={`${props.runningSubagents} running`}
              >
                {props.runningSubagents}
              </span>
            ) : null}
          </button>
        </div>
        <button
          type="button"
          className="context-drawer-close"
          onClick={props.onClose}
          aria-label="Close session rail"
          title="Close"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div className="context-drawer-body">
        {activeTab === "agents" ? (
          <AgentsRailWidget />
        ) : (
          <PlanPanelView entries={props.plan} />
        )}
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
