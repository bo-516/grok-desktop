/**
 * React binding for the chat canvas entrance baseline.
 * Decision logic is pure and lives in `@/lib/timelineEntrance`; this file only
 * carries it across renders.
 *
 * Boundary: local render bookkeeping — no store access, no DOM writes.
 */

import { useRef } from "react";
import {
  advanceTimelineEntranceBaseline,
  EMPTY_TIMELINE_ENTRANCE_BASELINE,
  type TimelineEntranceBaseline,
} from "@/lib/timelineEntrance";
import { timelineRenderUnitKey } from "@/lib/timelinePipeline";
import type { TimelineRenderUnitWithTurns } from "@/lib/turnGrouping";

/**
 * Units that must skip their entrance animation on this render.
 *
 * The baseline advances during render rather than in an effect: an effect would
 * run after the browser paints, leaving one frame of blank canvas after a rail
 * click — exactly the flash this removes.
 *
 * @param sessionId Session owning the canvas; null before any focus.
 * @param units Current top-level render units for that session.
 * @param restoringSessionId Store marker for a session opened without a cached
 *   transcript; compared against `sessionId` at switch time.
 * @returns Keys to render with `immediate`; empty for a live session's own new
 *   content, which is the case that should animate.
 */
export function useTimelineEntranceBaseline(
  sessionId: string | null,
  units: TimelineRenderUnitWithTurns[],
  restoringSessionId: string | null,
): ReadonlySet<string> {
  const baselineRef = useRef<TimelineEntranceBaseline>(
    EMPTY_TIMELINE_ENTRANCE_BASELINE,
  );
  baselineRef.current = advanceTimelineEntranceBaseline(baselineRef.current, {
    sessionId,
    unitKeys: units.map(timelineRenderUnitKey),
    restoringSessionId,
  });
  return baselineRef.current.seededUnitKeys;
}
