/**
 * Main-canvas timeline hook: field-picks the viewing session and delegates
 * to {@link useTimelineModel}. Must stay a thin wrapper so the panel and
 * canvas cannot drift.
 */

import { useSessionStore } from "@/store/sessionStore";
import { useTimelineModel, type TimelineWidgetModel } from "./useTimelineModel";

/**
 * Timeline orchestration for the viewing session on the main canvas.
 * Field-picks include `goal` so a worker wrap-up can fill a dry turn.
 * @returns Props bundle for {@link TimelineView} plus scroll handlers.
 */
export function useTimelineWidget(): TimelineWidgetModel {
  const timeline = useSessionStore((s) => s.session.timeline);
  const toolCalls = useSessionStore((s) => s.session.toolCalls);
  const status = useSessionStore((s) => s.session.status);
  const lastAgentText = useSessionStore((s) => s.session.lastAgentText);
  const goal = useSessionStore((s) => s.session.goal);
  const sessionId = useSessionStore(
    (s) => s.viewingSessionId ?? s.session.id ?? s.activeSessionId,
  );
  const restoringSessionId = useSessionStore((s) => s.restoringSessionId);
  const id = sessionId ?? "";

  return useTimelineModel({
    session: {
      id,
      timeline,
      toolCalls,
      status,
      lastAgentText,
      goal,
    },
    scrollKey: id,
    restoring: Boolean(sessionId) && restoringSessionId === sessionId,
  });
}

export type { TimelineWidgetModel };
