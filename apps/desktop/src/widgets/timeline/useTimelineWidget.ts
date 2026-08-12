/**
 * Unified entry hook for the chat timeline surface.
 * Owns session-store selects, stick-to-bottom, and derived render units.
 * Presentation lives in TimelineView (pure).
 */

import { useMemo } from "react";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import { timelineContentKey } from "@/lib/timelineContentKey";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { isTurnLive } from "@/lib/turnGrouping";
import { useSessionStore } from "@/store/sessionStore";
import { useTimelineEntranceBaseline } from "./useTimelineEntranceBaseline";
import { useTimelineStickToBottom } from "./useTimelineStickToBottom";

/**
 * Timeline orchestration: store + scroll + grouped units.
 * @returns Props bundle for {@link TimelineView} plus scroll handlers.
 */
export function useTimelineWidget() {
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const status = useSessionStore((s) => s.session.status);
  const lastAgentText = useSessionStore((s) => s.session.lastAgentText);
  const sessionId = useSessionStore(
    (s) => s.viewingSessionId ?? s.session.id ?? s.activeSessionId,
  );
  const restoringSessionId = useSessionStore((s) => s.restoringSessionId);

  const units = useMemo(
    () => buildTimelineRenderUnits(timeline, toolCalls),
    [timeline, toolCalls],
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
    () => timelineContentKey(timeline, status, lastAgentText, toolStatusSig),
    [timeline, status, lastAgentText, toolStatusSig],
  );
  // Stick-to-bottom only on session switch / live content growth — not on click.
  const { scrollRef, handleScroll } = useTimelineStickToBottom({
    sessionId,
    contentKey,
  });
  // Restored history renders instantly; only live arrivals keep the entrance.
  const seededUnitKeys = useTimelineEntranceBaseline(
    sessionId,
    units,
    restoringSessionId,
  );

  const isRestoring =
    timeline.length === 0 && restoringSessionId === sessionId;
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
  };
}

export type TimelineWidgetModel = ReturnType<typeof useTimelineWidget>;
