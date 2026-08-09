/**
 * Right context rail container — M1 hosts the plan panel only.
 * Future: diff / context tabs can share this shell without touching App.
 */

import type { PlanEntry } from "@grok-desktop/acp-core";
import { PlanPanelView } from "../PlanPanelView";

export type ContextRailWidgetProps = {
  /** Plan entries from the live session; empty still mounts the shell when open. */
  plan: PlanEntry[] | undefined;
  /** Close the rail (user dismiss — shell remembers for auto-open). */
  onClose: () => void;
};

/**
 * Fixed right rail with head chrome and PlanPanelView body.
 * @param props Plan data and close handler; missing onClose leaves Close inert.
 * @returns Aside with id=context-rail for aria-controls from top-nav toggle.
 */
export function ContextRailWidget(props: ContextRailWidgetProps) {
  return (
    <aside
      id="context-rail"
      className="context-rail rail-right"
      aria-label="Context"
    >
      <div className="rail-head context-rail-head">
        <span>Plan</span>
        <button type="button" className="btn" onClick={props.onClose}>
          Close
        </button>
      </div>
      <div className="context-rail-body">
        <PlanPanelView entries={props.plan} showApproval />
      </div>
    </aside>
  );
}
