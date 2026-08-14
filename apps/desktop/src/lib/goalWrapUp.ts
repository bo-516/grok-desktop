/**
 * Attach a Goal worker wrap-up to a turn that finished without a trailing
 * agent answer. grok-build's goal harness stores FINAL_RESPONSE on
 * `goal_updated.last_event_detail` and often never emits `agent_message_chunk`,
 * so the canvas would otherwise settle on an empty Worked rail.
 * Pure — no store, no DOM.
 */

import type { TimelineRenderUnitWithTurns } from "./turnGrouping";

/** One wrap-up to paint as the turn's final answer. */
export type GoalWrapUp = {
  /** Index into the turn-grouped unit list (a `type: "turn"` row). */
  unitIndex: number;
  /** Trimmed `last_event_detail` body; never empty when this object exists. */
  text: string;
};

/**
 * Whether a turn already has a real trailing agent answer.
 * Empty / whitespace-only answers do not count — those still look dry.
 * @param unit Candidate top-level unit.
 * @returns True when the turn owns visible answer text from the transcript.
 */
export function turnHasVisibleAnswer(
  unit: TimelineRenderUnitWithTurns,
): boolean {
  if (unit.type !== "turn") {
    return false;
  }
  return (unit.answer?.item.text ?? "").trim().length > 0;
}

/**
 * Index of the turn that should show `detail` as a fallback answer.
 * Picks the last turn that has no real answer so a later follow-up turn
 * (live or with its own answer) does not steal or hide the worker summary.
 * @param units Output of {@link groupTimelineTurns} / the timeline pipeline.
 * @param detail Raw `lastEventDetail`; blank / missing → no wrap-up.
 * @returns Unit index, or -1 when nothing should be painted.
 */
export function findGoalWrapUpUnitIndex(
  units: TimelineRenderUnitWithTurns[],
  detail: string | undefined,
): number {
  if (!(detail ?? "").trim()) {
    return -1;
  }
  /** Last dry turn index; later answered/follow-up turns must not steal this. */
  let last = -1;
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i];
    if (unit === undefined || unit.type !== "turn") {
      continue;
    }
    if (turnHasVisibleAnswer(unit)) {
      continue;
    }
    last = i;
  }
  return last;
}

/**
 * Resolve the single wrap-up to render, or undefined when the canvas already
 * has a trailing answer (or there is no detail / no empty turn).
 * @param units Turn-grouped timeline.
 * @param detail Goal `lastEventDetail` (may be undefined).
 * @returns Wrap-up payload for TimelineView, or undefined.
 */
export function resolveGoalWrapUp(
  units: TimelineRenderUnitWithTurns[],
  detail: string | undefined,
): GoalWrapUp | undefined {
  const text = (detail ?? "").trim();
  if (!text) {
    return undefined;
  }
  const unitIndex = findGoalWrapUpUnitIndex(units, text);
  if (unitIndex < 0) {
    return undefined;
  }
  return { unitIndex, text };
}
