/**
 * Unified entry hook for the chat timeline surface.
 * Owns session-store selects, find-in-conversation state, stick-to-bottom, and
 * derived render units. Presentation lives in TimelineView (pure).
 */

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { searchTimeline } from "@/lib/timelineSearch";
import { isTurnLive } from "@/lib/turnGrouping";
import { useSessionStore } from "@/store/sessionStore";
import { useTimelineStickToBottom } from "./useTimelineStickToBottom";

/**
 * Fingerprint timeline growth so stick-to-bottom can follow streams without
 * deep-comparing the whole item list.
 * @param timeline Ordered session items (may be empty).
 * @param status Session run status (affects generating row).
 * @param lastAgentText Latest agent buffer (grows on each chunk while streaming).
 * @param toolStatusSig Compact tool status map so in-place tool updates still pin-follow.
 * @returns Stable-enough string key; empty timeline → status-only key.
 */
function timelineContentKey(
  timeline: TimelineItem[],
  status: string,
  lastAgentText: string,
  toolStatusSig: string,
): string {
  const last = timeline[timeline.length - 1];
  if (!last) {
    return `0:${status}`;
  }
  let tail: string | number = last.id;
  if (last.kind === "agent" || last.kind === "thought") {
    tail = last.text.length;
  }
  return `${timeline.length}:${last.kind}:${tail}:${status}:${lastAgentText.length}:${toolStatusSig}`;
}

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
  const { scrollRef, handleScroll, scrollToBottom } = useTimelineStickToBottom({
    sessionId,
    contentKey,
  });

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

  /**
   * Clicking a message re-pins and scrolls to the latest turn.
   * Ignores interactive controls (buttons, links, inputs) so Copy / expand still work.
   * @param event bubble-phase click from the timeline surface.
   */
  const handleMessageClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("button, a, input, textarea, select, [role='button']")) {
      return;
    }
    // Only when the click landed on a message row, not empty padding / find bar.
    if (
      !target.closest(
        "[data-kind], .msg-user-wrap, .msg-agent-wrap, .item-user, .item-agent, .item-error, .turn-block",
      )
    ) {
      return;
    }
    scrollToBottom("smooth");
  };

  const activeHit = hits[findIndex];
  const isRestoring =
    timeline.length === 0 && restoringSessionId === sessionId;
  const isEmpty = timeline.length === 0;

  return {
    timeline,
    toolCalls: toolCalls as Record<string, ToolCallCard | undefined>,
    status,
    units,
    isRestoring,
    isEmpty,
    findOpen,
    findQuery,
    findIndex,
    hits,
    activeHit,
    scrollRef,
    handleScroll,
    handleMessageClick,
    setFindOpen,
    setFindQuery,
    setFindIndex,
    isTurnLive,
  };
}

export type TimelineWidgetModel = ReturnType<typeof useTimelineWidget>;
