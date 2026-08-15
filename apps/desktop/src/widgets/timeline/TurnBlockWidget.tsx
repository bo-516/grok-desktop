/**
 * Stateful turn shell: one activity rail + optional final answer for a prompt span.
 * Owns isOpen / durationMs. History rails stay collapsed on open; only the live
 * streaming turn expands by default. Auto-collapses on live→done when the user
 * has not toggled (so reopening a session never re-expands finished work).
 * Forwards `compact` to the rail so inspect does not run inner follow-scroll.
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
  formatDoneActivitySummary,
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
  /** When true, done label uses Stopped-style wording. */
  cancelled?: boolean;
  /**
   * Agents-inspector density: keep the activity rail (tool/thought title
   * rows) so a tools-only turn is not blank; tool bodies stay CSS-hidden.
   */
  compact?: boolean;
  /**
   * Goal worker wrap-up used only when this turn has no trailing agent
   * text. Ignored when `unit.answer` already has visible body.
   */
  fallbackAnswer?: string;
};

/**
 * Turn block: rail header + steps + answer.
 * Pure-text turns omit the rail entirely and only render the answer.
 * @param props Turn unit, live flag, tool map, and optional Goal wrap-up.
 * @returns One visual turn block (rail optional).
 */
export function TurnBlockWidget(props: TurnBlockWidgetProps) {
  const {
    unit,
    live,
    sessionStatus,
    toolCalls,
    answerShowCursor = false,
    cancelled = false,
    compact = false,
    fallbackAnswer,
  } = props;
  const openPreview = usePreviewStore((s) => s.openPreview);
  const changeSet = buildTurnChangeSet(unit, toolCalls);
  const hasRail = unit.activity.length > 0;
  /**
   * Expanded only while this turn is the live streaming span.
   * Opening a session keeps every finished Worked rail collapsed until the
   * user expands it (body remounts nested Thought/tool steps open by default).
   */
  const [isOpen, setIsOpen] = useState(live);
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
  /** Done rails keep a kind mix on the header so collapse is scannable. */
  const activitySummary = live
    ? ""
    : formatDoneActivitySummary(unit.activity);
  const label = formatTurnLabel({
    live,
    totalMs: durationMs,
    steps: unit.steps,
    cancelled: cancelled && !live,
    currentStepPreview: preview,
    activitySummary,
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
      })
    ) {
      setIsOpen(false);
      const startMs = turnEarliestStartMs(unit.activity);
      if (startMs !== undefined) {
        const wall = Date.now() - startMs;
        /**
         * Extend only when nested thought clocks under-count long tool work.
         * Multi-day reconnect deltas (e.g. 2224m) are not "worked" time — the
         * duration formatter also handles hours/days, but prefer sane capture.
         */
        const maxSane = Math.max(unit.totalMs * 2, 6 * 3600_000);
        if (wall > 0 && wall <= maxSane) {
          setDurationMs((prev) => Math.max(prev, wall));
        }
      }
    }
    // Stay open while live (including first mount of a new streaming turn).
    if (live && !userToggledRef.current) {
      setIsOpen(true);
    }
  }, [live, unit.activity]);

  /** Change list always opens the preview drawer (never expands in-panel). */
  const changeSummary =
    changeSet.fileCount > 0 ? (
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
    ) : null;
  /** Transcript trailing answer; empty when the turn ended on tools. */
  const answerText = unit.answer?.item.text ?? "";
  /** True when the transcript already has a visible final answer. */
  const hasAnswer = answerText.trim().length > 0;
  /** Trimmed Goal last_event_detail; unused when hasAnswer. */
  const wrapText = (fallbackAnswer ?? "").trim();
  /** Body painted under the rail: real answer, else wrap-up, else empty. */
  const resolvedAnswer = hasAnswer ? answerText : wrapText;
  /** True when the painted body is the Goal wrap-up, not an agent chunk. */
  const wrapUp = !hasAnswer && wrapText.length > 0;

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
            open={compact || isOpen}
            onToggle={() => {
              // Compact inspect stays expanded so title rows remain visible.
              if (compact) {
                return;
              }
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
                compact={compact}
              />
            }
            variant="shell-toggle"
            active={live}
            done={!live}
            bareLabel
            className="flex flex-col gap-3"
          />
          {changeSummary}
        </>
      ) : null}
      {resolvedAnswer || answerShowCursor ? (
        <TurnAnswerView
          text={resolvedAnswer}
          showCursor={answerShowCursor && !wrapUp}
          wrapUp={wrapUp}
        />
      ) : null}
    </div>
  );
}
