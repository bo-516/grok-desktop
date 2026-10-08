/**
 * Keep settled timeline render units referentially stable across streaming
 * chunks.
 *
 * `buildTimelineRenderUnits` allocates a new wrapper for every row on each
 * call. Prefix timeline items stay the same object (the reducer copies only
 * the tail), so a settled turn's wrappers are equal in content but not in
 * identity. React.memo on the row then bails out only when we hand it the
 * previous wrapper.
 *
 * Pure: no React, no store. A wrong `previous` (null, or units from another
 * session) just returns `next` — one extra render, never a stale row.
 */

import type { TimelineItem } from "@grok-desktop/acp-core";
import { timelineRenderUnitKey } from "./timelinePipeline";
import type {
  TimelineRenderUnitWithTurns,
  TurnActivityChild,
  TurnUnit,
} from "./turnGrouping";

/**
 * Reuse previous render-unit objects whose timeline items did not change.
 *
 * @param previous Units from the last paint, or null before the first one.
 *   Units built for a different timeline are safe: keys miss and `next` wins.
 * @param next Fresh units from {@link buildTimelineRenderUnits}. Not mutated.
 * @returns `previous` itself when every unit reused in the same order (callers
 *   can keep a stable array identity). Otherwise a new array whose unchanged
 *   slots are the previous objects and whose changed slots are `next`'s.
 *   Empty `previous` returns `next`.
 */
export function reuseTimelineRenderUnits(
  previous: readonly TimelineRenderUnitWithTurns[] | null,
  next: readonly TimelineRenderUnitWithTurns[],
): TimelineRenderUnitWithTurns[] {
  if (previous == null || previous.length === 0) {
    // Hand back the caller's array. The readonly parameter only forbids writes.
    return next as TimelineRenderUnitWithTurns[];
  }

  /** Key → last paint's wrapper. Duplicate keys keep the later unit. */
  const previousByKey = new Map<string, TimelineRenderUnitWithTurns>();
  for (const unit of previous) {
    previousByKey.set(timelineRenderUnitKey(unit), unit);
  }

  /** True when the result cannot be the previous array. */
  let changed = previous.length !== next.length;
  /** Slots in `next` order, with unchanged wrappers substituted. */
  const reused: TimelineRenderUnitWithTurns[] = [];
  for (let index = 0; index < next.length; index += 1) {
    const unit = next[index];
    if (unit === undefined) {
      changed = true;
      continue;
    }
    const prior = previousByKey.get(timelineRenderUnitKey(unit));
    if (prior !== undefined && sameTimelineRenderUnit(prior, unit)) {
      reused.push(prior);
      if (previous[index] !== prior) {
        changed = true;
      }
    } else {
      reused.push(unit);
      changed = true;
    }
  }

  if (!changed && reused.length === previous.length) {
    // Same objects in the same order. Callers must not mutate the array.
    return previous as TimelineRenderUnitWithTurns[];
  }
  return reused;
}

/**
 * True when two wrappers paint the same timeline items.
 * Compares item object identity (the reducer replaces a changed row) and
 * group id lists by value (groups have no item object of their own).
 * A true result means the previous wrapper is safe to keep. A false result
 * forces the new wrapper through so the row re-renders.
 * @param previous Wrapper from the last paint.
 * @param next Wrapper just built for the same key.
 */
export function sameTimelineRenderUnit(
  previous: TimelineRenderUnitWithTurns,
  next: TimelineRenderUnitWithTurns,
): boolean {
  if (previous === next) {
    return true;
  }
  if (previous.type !== next.type) {
    return false;
  }
  if (previous.type === "turn" && next.type === "turn") {
    return sameTurnUnit(previous, next);
  }
  return sameActivityChild(
    previous as TurnActivityChild,
    next as TurnActivityChild,
  );
}

/**
 * True when two turn wrappers share the same activity items and answer item.
 * `steps` / `totalMs` are derived from those items; a mismatch means the
 * derivation changed and the new wrapper must paint.
 * @param previous Last paint's turn.
 * @param next Fresh turn with the same id.
 */
function sameTurnUnit(previous: TurnUnit, next: TurnUnit): boolean {
  if (previous.id !== next.id) {
    return false;
  }
  if (previous.steps !== next.steps || previous.totalMs !== next.totalMs) {
    return false;
  }
  if ((previous.answer?.item ?? null) !== (next.answer?.item ?? null)) {
    return false;
  }
  if (previous.activity.length !== next.activity.length) {
    return false;
  }
  for (let index = 0; index < previous.activity.length; index += 1) {
    const priorChild = previous.activity[index];
    const nextChild = next.activity[index];
    if (
      priorChild === undefined ||
      nextChild === undefined ||
      !sameActivityChild(priorChild, nextChild)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * True when two rail children (or residual top-level units) show the same items.
 * @param previous Last paint's child.
 * @param next Fresh child.
 */
function sameActivityChild(
  previous: TurnActivityChild,
  next: TurnActivityChild,
): boolean {
  if (previous.type !== next.type) {
    return false;
  }
  if (previous.type === "item" && next.type === "item") {
    return previous.item === next.item;
  }
  if (previous.type === "tool_group" && next.type === "tool_group") {
    return (
      previous.id === next.id &&
      previous.count === next.count &&
      sameStrings(previous.toolCallIds, next.toolCallIds) &&
      sameStrings(previous.kinds, next.kinds)
    );
  }
  if (previous.type === "thought_group" && next.type === "thought_group") {
    return (
      previous.id === next.id &&
      previous.count === next.count &&
      previous.totalMs === next.totalMs &&
      sameItemRefs(previous.items, next.items)
    );
  }
  if (previous.type === "subagent_group" && next.type === "subagent_group") {
    return (
      previous.id === next.id &&
      previous.waitToolCallId === next.waitToolCallId &&
      sameStrings(previous.toolCallIds, next.toolCallIds)
    );
  }
  return false;
}

/**
 * Value equality for short id / kind lists. Order matters.
 * @param previous Prior list.
 * @param next Fresh list. A different length or any differing slot is false.
 */
function sameStrings(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Reference equality for timeline items inside a thought group.
 * A replaced thought (new text or completedAt) is a new object and fails.
 * @param previous Prior thought items.
 * @param next Fresh thought items.
 */
function sameItemRefs(
  previous: readonly TimelineItem[],
  next: readonly TimelineItem[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return false;
    }
  }
  return true;
}
