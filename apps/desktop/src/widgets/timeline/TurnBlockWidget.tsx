/**
 * Stateful turn shell: one activity rail + optional final answer for a prompt span.
 * Owns isOpen / durationMs; auto-collapses on live→done when an answer exists
 * and the user has not toggled (tool-only turns stay open / readable).
 */

import cs from "classnames";
import { useEffect, useRef, useState } from "react";
import type { SessionStatus, ToolCallCard } from "@grok-desktop/acp-core";
import {
  buildTurnChangeSet,
  collectToolCallIdsFromTurn,
} from "@/lib/changeSet";
import {
  turnEarliestStartMs,
  type TurnUnit,
} from "@/lib/turnGrouping";
import {
  currentStepPreview,
  formatTurnLabel,
  shouldAutoCollapseTurn,
} from "@/lib/turnLabel";
import { usePreviewStore } from "@/store/previewStore";
import { CollapsibleStepView } from "@/widgets/shared";
import { TurnActivityRailView } from "./TurnActivityRailView";
import { TurnAnswerView } from "./TurnAnswerView";
import { TurnChangeSummaryView } from "./TurnChangeSummaryView";

type TurnBlockWidgetProps = {
  /** Group produced by {@link groupTimelineTurns}. */
  unit: TurnUnit;
  /**
   * True while this turn is still the active streaming span.
   * Controls default expand and the Working… label.
   */
  live: boolean;
  sessionStatus: SessionStatus;
  toolCalls: Record<string, ToolCallCard | undefined>;
  /** True when the answer item is the last timeline agent and session is streaming. */
  answerShowCursor?: boolean;
  /** Optional find highlight for the answer body. */
  answerHighlight?: boolean;
  /** When true, done label uses Stopped-style wording. */
  cancelled?: boolean;
};

/**
 * Turn block: rail header + steps + answer.
 * Pure-text turns omit the rail entirely and only render the answer.
 * @param props Turn unit, live flag, and tool map for nested cards.
 * @returns One visual turn block (rail optional).
 */
export function TurnBlockWidget(props: TurnBlockWidgetProps) {
  const {
    unit,
    live,
    sessionStatus,
    toolCalls,
    answerShowCursor = false,
    answerHighlight = false,
    cancelled = false,
  } = props;
  const openPreview = usePreviewStore((s) => s.openPreview);
  const changeSet = buildTurnChangeSet(unit, toolCalls);
  const hasRail = unit.activity.length > 0;
  const hasAnswer = unit.answer !== undefined;
  /**
   * Expanded while live; completed history with an answer defaults collapsed.
   * Tool-only / no-answer turns stay open so the rail remains readable.
   */
  const [isOpen, setIsOpen] = useState(live || !hasAnswer);
  /**
   * Display duration: thought wall span, optionally extended to Date.now()
   * when a live block finishes after long tool work.
   */
  const [durationMs, setDurationMs] = useState(unit.totalMs);
  /** Once true, live→done must not force-collapse (user owns expand state). */
  const userToggledRef = useRef(false);
  /** Previous live flag so we only auto-collapse on the streaming → done edge. */
  const prevLiveRef = useRef(live);
  const preview = live
    ? currentStepPreview(unit.activity, sessionStatus)
    : "";
  const label = formatTurnLabel({
    live,
    totalMs: durationMs,
    steps: unit.steps,
    cancelled: cancelled && !live,
    currentStepPreview: preview,
  });
  const className = cs("turn-block", {
    "turn-block-open": isOpen,
  });

  useEffect(() => {
    // History / late thought timestamps may raise the baseline duration.
    setDurationMs((prev) => Math.max(prev, unit.totalMs));
  }, [unit.totalMs]);

  useEffect(() => {
    const prevLive = prevLiveRef.current;
    prevLiveRef.current = live;
    if (
      shouldAutoCollapseTurn({
        prevLive,
        live,
        userToggled: userToggledRef.current,
        hasAnswer,
      })
    ) {
      setIsOpen(false);
      const startMs = turnEarliestStartMs(unit.activity);
      if (startMs !== undefined) {
        const wall = Date.now() - startMs;
        if (wall > 0) {
          setDurationMs((prev) => Math.max(prev, wall));
        }
      }
    }
    // Stay open while live (including first mount of a new streaming turn).
    if (live && !userToggledRef.current) {
      setIsOpen(true);
    }
    // Tool-only ends: keep rail open when settling if user never toggled.
    if (!live && !hasAnswer && !userToggledRef.current) {
      setIsOpen(true);
    }
  }, [live, unit.activity, hasAnswer]);

  return (
    <div
      className={className}
      data-kind="turn"
      data-live={live ? "1" : "0"}
      data-steps={unit.steps}
    >
      {hasRail ? (
        <>
          <CollapsibleStepView
            open={isOpen}
            onToggle={() => {
              userToggledRef.current = true;
              setIsOpen((open) => !open);
            }}
            label={label}
            body={
              <TurnActivityRailView
                activity={unit.activity}
                sessionStatus={sessionStatus}
                toolCalls={toolCalls}
                live={live}
              />
            }
            variant="shell-toggle"
            active={live}
            done={!live}
            bareLabel
            className="flex flex-col gap-3"
          />
          {changeSet.fileCount > 0 ? (
            <TurnChangeSummaryView
              changeSet={changeSet}
              onOpen={() =>
                openPreview({
                  kind: "changeset",
                  scope: "turn",
                  turnId: unit.id,
                  // Capture ids at click time — drawer must not re-group turns.
                  toolCallIds: collectToolCallIdsFromTurn(unit),
                })
              }
            />
          ) : null}
        </>
      ) : null}
      {unit.answer ? (
        <TurnAnswerView
          text={unit.answer.item.text}
          showCursor={answerShowCursor}
          highlight={answerHighlight}
        />
      ) : null}
    </div>
  );
}
