/**
 * Unified entry hook for the chat timeline surface.
 * Owns session-store selects, find-in-conversation state, stick-to-bottom, and
 * derived render units. Presentation lives in TimelineView (pure).
 */

import { useEffect, useMemo, useState } from "react";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import { timelineContentKey } from "@/lib/timelineContentKey";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { searchTimeline } from "@/lib/timelineSearch";
import { isTurnLive } from "@/lib/turnGrouping";
import { useSessionStore } from "@/store/sessionStore";
import { useTimelineEntranceBaseline } from "./useTimelineEntranceBaseline";
import { useTimelineStickToBottom } from "./useTimelineStickToBottom";

/**
 * Timeline orchestration: store + find + scroll + grouped units.
 * @returns Props bundle for {@link TimelineView} plus scroll/find handlers.
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
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);

  const units = useMemo(
    () => buildTimelineRenderUnits(timeline, toolCalls),
    [timeline, toolCalls],
  );
  const hits = useMemo(
    () => searchTimeline(timeline, findQuery),
    [timeline, findQuery],
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

  // ⌘F conversation search (F-STREAM-14)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeHit = hits[findIndex];
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
    findOpen,
    findQuery,
    findIndex,
    hits,
    activeHit,
    scrollRef,
    handleScroll,
    setFindOpen,
    setFindQuery,
    setFindIndex,
    isTurnLive,
  };
}

export type TimelineWidgetModel = ReturnType<typeof useTimelineWidget>;
