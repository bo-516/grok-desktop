/**
 * One top-level timeline row: user bubble, turn, error, or residual step.
 * Stateless. Memo lives on {@link TimelineUnitRowWidget} so a streaming
 * chunk can skip settled rows. Entrance animation stays on FadeContent;
 * content-visibility and the code-highlight scope are applied here from
 * props the widget already decided.
 */

import type { CSSProperties, RefObject } from "react";
import type {
  SessionStatus,
  ToolCallCard,
} from "@grok-desktop/acp-core";
import type { TimelineRenderUnitWithTurns } from "@/lib/turnGrouping";
import { FadeContent } from "@/components/react-bits";
import {
  CodeHighlightVisibilityProvider,
  type CodeHighlightVisibility,
} from "@/widgets/shared";
import { TurnBlockWidget } from "./TurnBlockWidget";
import { TurnStepView } from "./TurnStepView";
import { UserMessageView } from "./UserMessageView";

export type TimelineUnitRowViewProps = {
  /** Top-level unit. A reused object means this row's items did not change. */
  unit: TimelineRenderUnitWithTurns;
  /**
   * Stable key for the row (also the React key). Passed again so the memo
   * compare can see it without reading the unit's private id shape.
   */
  unitKey: string;
  /**
   * True only for the streaming turn. That row stays fully laid out
   * (no content-visibility) so stick-to-bottom measures real growth.
   */
  live: boolean;
  /** True when this row is restored history and must not fade in. */
  seeded: boolean;
  /** Session runtime status, forwarded to the turn / step. */
  sessionStatus: SessionStatus;
  /**
   * Session tool-call map. The memo compare treats it as equal when this
   * row's own cards are the same objects, even if the map is new.
   */
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** True when this row's answer is the streaming caret target. */
  answerShowCursor: boolean;
  /** Agents-inspector density. */
  compact: boolean;
  /**
   * Goal wrap-up text for this turn, or undefined when the row is not the
   * wrap-up target. Empty string still means "this is the wrap-up row".
   */
  fallbackAnswer?: string;
  /**
   * Shell class. Includes `timeline-settled` only when `live` is false.
   * The widget owns that choice so the view does not re-derive it.
   */
  shellClassName: string;
  /**
   * Optional shell style — carries the remembered contain-intrinsic estimate
   * (`auto <measured>px`) for settled rows on a remount. Layout-only; color
   * styles are forbidden by project rules anyway.
   */
  shellStyle?: CSSProperties;
  /** "1" when content-visibility applies. Mirrors `timeline-settled`. */
  settled: "0" | "1";
  /** Shiki timing for fences inside this row. */
  codeVisibility: CodeHighlightVisibility;
  /** Row shell, observed for the highlight prefetch band. */
  shellRef: RefObject<HTMLDivElement | null>;
};

/**
 * Paint one timeline row.
 * @param props Unit plus the flags the widget derived. A missing `unit`
 *   is a type error; a stale `live` flag would hide the streaming turn
 *   behind content-visibility and break stick-to-bottom.
 */
export function TimelineUnitRowView(props: TimelineUnitRowViewProps) {
  const {
    unit,
    live,
    seeded,
    sessionStatus,
    toolCalls,
    answerShowCursor,
    compact,
    fallbackAnswer,
    shellClassName,
    shellStyle,
    settled,
    codeVisibility,
    shellRef,
  } = props;

  return (
    <CodeHighlightVisibilityProvider visibility={codeVisibility}>
      <div
        ref={shellRef}
        className={shellClassName}
        style={shellStyle}
        data-settled={settled}
        data-live={live ? "1" : "0"}
      >
        {renderRowBody({
          unit,
          seeded,
          sessionStatus,
          toolCalls,
          answerShowCursor,
          compact,
          fallbackAnswer,
          live,
        })}
      </div>
    </CodeHighlightVisibilityProvider>
  );
}

type RowBodyProps = {
  /** Unit to paint. */
  unit: TimelineRenderUnitWithTurns;
  /** Skip the entrance fade when true. */
  seeded: boolean;
  /** Session status for nested steps. */
  sessionStatus: SessionStatus;
  /** Tool cards for nested steps. */
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** Streaming caret on the answer. */
  answerShowCursor: boolean;
  /** Inspector density. */
  compact: boolean;
  /** Goal wrap-up, if this turn is the target. */
  fallbackAnswer?: string;
  /** Streaming turn. Forwarded so the turn block opens its rail. */
  live: boolean;
};

/**
 * The FadeContent body for one unit kind. Split out so the shell (highlight
 * scope + content-visibility) stays one place and the kind switch stays flat.
 * @param props Row presentation fields. `unit` selects the branch.
 */
function renderRowBody(props: RowBodyProps) {
  const {
    unit,
    seeded,
    sessionStatus,
    toolCalls,
    answerShowCursor,
    compact,
    fallbackAnswer,
    live,
  } = props;

  if (unit.type === "turn") {
    // One FadeContent per turn so rail repartition does not re-enter every step.
    return (
      <FadeContent
        className="msg-agent-wrap"
        durationMs={320}
        immediate={seeded}
      >
        <TurnBlockWidget
          unit={unit}
          live={live}
          sessionStatus={sessionStatus}
          toolCalls={toolCalls}
          answerShowCursor={answerShowCursor}
          compact={compact}
          fallbackAnswer={fallbackAnswer}
        />
      </FadeContent>
    );
  }

  if (unit.type === "item" && unit.item.kind === "user") {
    return (
      <FadeContent durationMs={320} immediate={seeded}>
        <UserMessageView blocks={unit.item.blocks} />
      </FadeContent>
    );
  }

  if (unit.type === "item" && unit.item.kind === "error") {
    return (
      <FadeContent className="msg-agent-wrap" immediate={seeded}>
        <div className="item-error" data-kind="error">
          {unit.item.message}
        </div>
      </FadeContent>
    );
  }

  // Residual agent / thought / tool / groups outside a turn.
  return (
    <FadeContent className="msg-agent-wrap" durationMs={320} immediate={seeded}>
      <TurnStepView
        child={unit}
        sessionStatus={sessionStatus}
        toolCalls={toolCalls}
      />
    </FadeContent>
  );
}
