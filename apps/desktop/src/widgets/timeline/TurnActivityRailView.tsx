/**
 * Stateless activity rail: ordered turn steps under a quiet left guide line.
 * Expand/collapse of the rail itself lives in TurnBlockWidget.
 * Height is capped via `.turn-rail` (viewport-adaptive, min 280px) so long
 * activity lists scroll inside the rail instead of stretching the timeline.
 * Agents inspect lifts that cap (`.agents-transcript .turn-rail`) so the
 * 300px drawer does not grow a second scrollbar in the middle of the pane.
 */

import type { SessionStatus, ToolCallCard } from "@grok-desktop/acp-core";
import type { TurnActivityChild } from "@/lib/turnGrouping";
import { TurnStepView } from "./TurnStepView";

type TurnActivityRailViewProps = {
  /** Rail children in timeline order (narration / thought / tool). */
  activity: TurnActivityChild[];
  sessionStatus: SessionStatus;
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** When live, the last step is highlighted as the current focus. */
  live: boolean;
};

/**
 * Renders the expanded activity list for one turn.
 * @param props Activity units and session/tool context for nested cards.
 * @returns A role=list rail, or null when activity is empty.
 */
export function TurnActivityRailView(props: TurnActivityRailViewProps) {
  const { activity, sessionStatus, toolCalls, live } = props;
  if (activity.length === 0) {
    return null;
  }
  const lastIndex = activity.length - 1;
  return (
    <div className="turn-rail" role="list" data-kind="turn-rail">
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
