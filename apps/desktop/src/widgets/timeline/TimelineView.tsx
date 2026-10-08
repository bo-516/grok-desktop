/**
 * Pure chat canvas presentation: ordered stream of user / turn / error.
 * Residual work units (tool_group / thought_group / lone agent|thought|tool)
 * funnel through TurnStepView only — no parallel JSX tree.
 * Stateful orchestration lives in useTimelineWidget / TimelineWidget.
 * The live-turn strip lives in the composer dock (not this scroller) so a
 * sticky pill cannot paint through the streaming answer.
 */

import cs from "classnames";
import type { RefObject, UIEvent } from "react";
import type {
  SessionStatus,
  TimelineItem,
  ToolCallCard,
} from "@grok-desktop/acp-core";
import { timelineRenderUnitKey } from "@/lib/timelinePipeline";
import type {
  isTurnLive as isTurnLiveFn,
  TimelineRenderUnitWithTurns,
} from "@/lib/turnGrouping";
import { BlurText, FadeContent, ShinyText } from "@/components/react-bits";
import { TimelineUnitRowWidget } from "./TimelineUnitRowWidget";

export type TimelineViewProps = {
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard | undefined>;
  status: SessionStatus;
  units: TimelineRenderUnitWithTurns[];
  /**
   * Unit keys that count as restored history: rendered with no entrance
   * animation so switching sessions in the rail does not blank and re-reveal a
   * conversation the user already read. An empty set animates everything.
   */
  seededUnitKeys: ReadonlySet<string>;
  isRestoring: boolean;
  isEmpty: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
  /** Bound isTurnLive from turnGrouping (injected for pure tests). */
  isTurnLive: typeof isTurnLiveFn;
  /**
   * Narrow Agents-inspector density: pass compact to turn blocks (activity
   * rail stays; tool bodies CSS-collapse). The live-turn strip is not a
   * child of this scroller.
   */
  compact?: boolean;
  /**
   * Index into `units` of the turn that should show Goal wrap-up text.
   * -1 / omitted → no fallback answer.
   */
  wrapUpIndex?: number;
  /** Trimmed `last_event_detail`; ignored when wrapUpIndex is unset. */
  wrapUpText?: string;
};

/**
 * Renders the ordered ACP timeline as user / turn / error top-level units.
 * @param props Presentation model from useTimelineWidget; wrap-up fields
 *   fill a Goal turn that has no trailing agent chunk. No store access.
 * @returns An empty-state guide when the session has no events, or the live chat canvas.
 */
export function TimelineView(props: TimelineViewProps) {
  const {
    timeline,
    toolCalls,
    status,
    units,
    seededUnitKeys,
    isRestoring,
    isEmpty,
    scrollRef,
    handleScroll,
    isTurnLive,
    compact = false,
    wrapUpIndex = -1,
    wrapUpText = "",
  } = props;

  // Uncached session mid-restore: replay is silent, so the New chat guide would
  // claim an empty conversation that is actually still loading.
  if (isRestoring) {
    return (
      <div className="timeline" ref={scrollRef} onScroll={handleScroll}>
        <div className="empty">
          <p className="empty-sub">
            <ShinyText text="Restoring conversation…" speed="slow" />
          </p>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="timeline" ref={scrollRef} onScroll={handleScroll}>
        <div className="empty">
          <BlurText
            text="What can I help with?"
            className="empty-title"
            animateBy="words"
            delay={70}
          />
          <FadeContent delayMs={180} blur>
            <p className="empty-sub">
              Describe a task for live grok-build. Use @ to attach files and /
              for commands.
            </p>
          </FadeContent>
          <p className="empty-sub">
            <ShinyText text="Live grok-build · ready when you are" speed="slow" />
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cs("timeline", { "agents-transcript": compact })}
      ref={scrollRef}
      data-status={status}
      data-timeline-compact={compact ? "1" : undefined}
      onScroll={handleScroll}
    >
      {units.map((unit, unitIndex) => {
        const unitKey = timelineRenderUnitKey(unit);
        // History restored by a rail click paints instantly; only content that
        // arrives while this canvas is open earns the entrance transition.
        const seeded = seededUnitKeys.has(unitKey);
        const live = unit.type === "turn" && isTurnLive(units, unitIndex, status);
        const answerId = unit.type === "turn" ? unit.answer?.item.id : undefined;
        const isLastAnswer =
          answerId !== undefined &&
          timeline[timeline.length - 1]?.id === answerId;
        const answerShowCursor = status === "streaming" && isLastAnswer;
        return (
          <TimelineUnitRowWidget
            key={unitKey}
            unit={unit}
            unitKey={unitKey}
            live={live}
            seeded={seeded}
            sessionStatus={status}
            toolCalls={toolCalls}
            answerShowCursor={answerShowCursor}
            compact={compact}
            fallbackAnswer={
              unitIndex === wrapUpIndex ? wrapUpText : undefined
            }
          />
        );
      })}
    </div>
  );
}
