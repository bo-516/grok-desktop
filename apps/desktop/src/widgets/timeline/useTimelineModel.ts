/**
 * Snapshot-driven timeline model shared by the main canvas and the Agents
 * inspector. The only production UI path that builds render units.
 */

import { useMemo } from "react";
import type { SessionState, ToolCallCard } from "@grok-desktop/acp-core";
import { resolveGoalWrapUp } from "@/lib/goalWrapUp";
import { timelineContentKey } from "@/lib/timelineContentKey";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { isTurnLive } from "@/lib/turnGrouping";
import { useTimelineEntranceBaseline } from "./useTimelineEntranceBaseline";
import { useTimelineStickToBottom } from "./useTimelineStickToBottom";

/**
 * Fields a timeline snapshot must expose. Callers pass a full SessionState or
 * a field-picked view so unrelated session keys do not retrigger the canvas.
 */
export type TimelineModelSession = Pick<
  SessionState,
  "timeline" | "toolCalls" | "status" | "lastAgentText" | "id" | "goal"
>;

export type UseTimelineModelArgs = {
  /**
   * Session snapshot to render. Wrong/stale snapshot paints that snapshot —
   * it does not fall back to the viewing session.
   */
  session: TimelineModelSession;
  /**
   * Stick-to-bottom / entrance identity. Main canvas uses the viewing session
   * id; the Agents panel must pass `agents:<childId>` so the two scrolls
   * never share pin state.
   */
  scrollKey: string;
  /**
   * True while a cold restore is in flight for this snapshot (empty timeline
   * + matching restoringSessionId). Panel inspect is always local, so omit.
   */
  restoring?: boolean;
};

/**
 * Build TimelineView props from an external session snapshot.
 * Same grouping / stick-to-bottom / entrance rules as the main canvas.
 * @param args Snapshot, scroll identity, optional restoring flag.
 * @returns Props bundle for {@link TimelineView} plus scroll handlers.
 */
export function useTimelineModel(args: UseTimelineModelArgs) {
  const { session, scrollKey, restoring = false } = args;
  const { timeline, toolCalls, status, lastAgentText, goal } = session;
  /** Worker wrap-up length so stick-to-bottom follows a late last_event_detail. */
  const wrapUpSig = goal?.lastEventDetail ?? "";

  const units = useMemo(
    () => buildTimelineRenderUnits(timeline, toolCalls),
    [timeline, toolCalls],
  );
  const wrapUp = useMemo(
    () => resolveGoalWrapUp(units, goal?.lastEventDetail),
    [units, goal?.lastEventDetail],
  );
  const toolStatusSig = useMemo(
    () =>
      Object.keys(toolCalls)
        .sort()
        .map((id) => `${id}:${toolCalls[id]?.status ?? ""}`)
        .join(","),
    [toolCalls],
  );
  const contentKey = useMemo(
    () =>
      timelineContentKey(
        timeline,
        status,
        lastAgentText,
        toolStatusSig,
        wrapUpSig,
      ),
    [timeline, status, lastAgentText, toolStatusSig, wrapUpSig],
  );
  const { scrollRef, handleScroll } = useTimelineStickToBottom({
    sessionId: scrollKey,
    contentKey,
  });
  const restoringSessionId = restoring ? scrollKey : null;
  const seededUnitKeys = useTimelineEntranceBaseline(
    scrollKey,
    units,
    restoringSessionId,
  );

  const isRestoring = timeline.length === 0 && restoring;
  const isEmpty = timeline.length === 0;

  return {
    timeline,
    toolCalls: toolCalls as Record<string, ToolCallCard | undefined>,
    status,
    units,
    seededUnitKeys,
    isRestoring,
    isEmpty,
    scrollRef,
    handleScroll,
    isTurnLive,
    wrapUpIndex: wrapUp?.unitIndex ?? -1,
    wrapUpText: wrapUp?.text ?? "",
  };
}

/** Props bundle consumed by TimelineView (main canvas and Agents panel). */
export type TimelineWidgetModel = ReturnType<typeof useTimelineModel>;
