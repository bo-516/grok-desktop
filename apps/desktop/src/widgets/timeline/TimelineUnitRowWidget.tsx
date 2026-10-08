/**
 * Stateful shell for one timeline row.
 *
 * Memoized: while the last turn streams, settled rows keep the same unit
 * object and the same card identities, so this function does not run.
 * The hook owns near-viewport highlighting; the view owns markup.
 */

import cs from "classnames";
import { memo } from "react";
import type { SessionStatus, ToolCallCard } from "@grok-desktop/acp-core";
import type { TimelineRenderUnitWithTurns } from "@/lib/turnGrouping";
import { noteTimelineUnitRowRender } from "./timelineRowRenderProbe";
import { timelineUnitRowPropsEqual } from "./timelineUnitRowPropsEqual";
import {
  TimelineUnitRowView,
  type TimelineUnitRowViewProps,
} from "./TimelineUnitRowView";
import { useTimelineRowHighlight } from "./useTimelineRowHighlight";

export type TimelineUnitRowWidgetProps = {
  /** Top-level unit from the reused render list. */
  unit: TimelineRenderUnitWithTurns;
  /** React key / probe id. Stable for the life of the row. */
  unitKey: string;
  /**
   * Streaming turn. False for every settled row, including the user bubble
   * that opened the live turn.
   */
  live: boolean;
  /** Restored history: FadeContent paints immediately. */
  seeded: boolean;
  /** Session runtime status. */
  sessionStatus: SessionStatus;
  /** Tool-call map. Compared per row, not by map identity. */
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** Streaming caret on this row's answer. */
  answerShowCursor: boolean;
  /** Agents-inspector density. */
  compact: boolean;
  /** Goal wrap-up text when this row is the wrap-up turn. */
  fallbackAnswer?: string;
};

/**
 * Build the shell class. Settled rows opt into content-visibility; the live
 * row must stay in normal layout so scrollHeight tracks the stream.
 * @param live Streaming-turn flag.
 */
function rowShellClassName(live: boolean): string {
  return cs("w-full min-w-0", { "timeline-settled": !live });
}

/**
 * Connect highlight visibility and render the row.
 * @param props Row model from {@link TimelineView}. A stale `unit` paints
 *   that unit; the parent is responsible for reuse.
 */
function TimelineUnitRowWidgetInner(props: TimelineUnitRowWidgetProps) {
  const {
    unit,
    unitKey,
    live,
    seeded,
    sessionStatus,
    toolCalls,
    answerShowCursor,
    compact,
    fallbackAnswer,
  } = props;
  const highlight = useTimelineRowHighlight(live);
  /** "1" when the settled shortcut applies. Kept in sync with the class. */
  const settled = live ? "0" : "1";

  noteTimelineUnitRowRender(unitKey, live);

  const viewProps: TimelineUnitRowViewProps = {
    unit,
    unitKey,
    live,
    seeded,
    sessionStatus,
    toolCalls,
    answerShowCursor,
    compact,
    fallbackAnswer,
    shellClassName: rowShellClassName(live),
    settled,
    codeVisibility: highlight.visibility,
    shellRef: highlight.shellRef,
  };

  return <TimelineUnitRowView {...viewProps} />;
}

/**
 * Memoized row. Settled rows skip the render when {@link timelineUnitRowPropsEqual}
 * reports the unit and that row's cards unchanged.
 */
export const TimelineUnitRowWidget = memo(
  TimelineUnitRowWidgetInner,
  timelineUnitRowPropsEqual,
);
TimelineUnitRowWidget.displayName = "TimelineUnitRowWidget";
