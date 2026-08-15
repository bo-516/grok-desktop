/**
 * Activity rail: ordered turn steps under a quiet left guide line.
 * Expand/collapse of the rail itself lives in TurnBlockWidget.
 * Height is capped via `.turn-rail` (viewport-adaptive, min 280px) so long
 * activity lists scroll inside the rail instead of stretching the timeline.
 * Live rails stick-to-bottom via {@link useTurnRailStickToBottom} so an
 * expanded thought / Working body follows new steps; history stays at top.
 * Agents inspect lifts that cap (`.agents-transcript .turn-rail`) so the
 * 300px drawer does not grow a second scrollbar in the middle of the pane.
 *
 * Local scroll pin only — no store. Presentation stays in the mapped steps.
 */

import type { SessionStatus, ToolCallCard } from "@grok-desktop/acp-core";
import type { TurnActivityChild } from "@/lib/turnGrouping";
import { TurnStepView } from "./TurnStepView";
import { useTurnRailStickToBottom } from "./useTurnRailStickToBottom";

type TurnActivityRailViewProps = {
  /** Rail children in timeline order (narration / thought / tool). */
  activity: TurnActivityChild[];
  sessionStatus: SessionStatus;
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** When live, the last step is highlighted as the current focus. */
  live: boolean;
  /**
   * Agents-inspector density: rail overflow is lifted by CSS, so follow
   * scroll must stay off or it fights the inspector timeline scroller.
   */
  compact?: boolean;
};

/**
 * Renders the expanded activity list for one turn.
 * @param props Activity units and session/tool context for nested cards.
 *   `live` + not `compact` enables stick-to-bottom; history rails start at top.
 * @returns A role=list rail, or null when activity is empty.
 */
export function TurnActivityRailView(props: TurnActivityRailViewProps) {
  const {
    activity,
    sessionStatus,
    toolCalls,
    live,
    compact = false,
  } = props;
  const { scrollRef, handleScroll } = useTurnRailStickToBottom({
    enabled: live && !compact,
    structureKey: activity.length,
  });
  if (activity.length === 0) {
    return null;
  }
  const lastIndex = activity.length - 1;
  return (
    <div
      ref={scrollRef}
      className="turn-rail"
      role="list"
      data-kind="turn-rail"
      onScroll={handleScroll}
    >
      <div className="turn-rail-body">
        {activity.map((child, index) => (
          <TurnStepView
            key={stepKey(child)}
            child={child}
            sessionStatus={sessionStatus}
            toolCalls={toolCalls}
            active={live && index === lastIndex}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Stable React key for a rail child unit.
 * @param child Nested activity unit.
 */
function stepKey(child: TurnActivityChild): string {
  if (child.type === "item") {
    return child.item.id;
  }
  return child.id;
}
