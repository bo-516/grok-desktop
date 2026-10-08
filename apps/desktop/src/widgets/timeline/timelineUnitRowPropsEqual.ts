/**
 * Custom props compare for a memoized timeline row.
 *
 * Streaming replaces the whole `toolCalls` map when any card patches, and
 * replaces the tail timeline item when text grows. Settled rows must ignore
 * both: their unit wrapper is reused ({@link reuseTimelineRenderUnits}) and
 * their own cards keep object identity. Comparing the map by reference would
 * redraw every row on a tool tick that only touched the live turn.
 */

import type { ToolCallCard } from "@grok-desktop/acp-core";
import { collectToolCallIdsFromTurn } from "@/lib/changeSet";
import type { TimelineRenderUnitWithTurns } from "@/lib/turnGrouping";
import type { TimelineUnitRowWidgetProps } from "./TimelineUnitRowWidget";

/** Shared empty id list so tool-free rows do not allocate on every compare. */
const NO_TOOL_IDS: readonly string[] = [];

/**
 * Tool-call ids this row paints. Order is activity order for turns.
 * A missing id is fine: the card compare treats `undefined === undefined`
 * as unchanged. Passing the wrong unit returns that unit's ids only.
 * @param unit Top-level render unit for one row.
 */
export function toolCallIdsInRenderUnit(
  unit: TimelineRenderUnitWithTurns,
): readonly string[] {
  if (unit.type === "turn") {
    return collectToolCallIdsFromTurn(unit);
  }
  if (unit.type === "tool_group") {
    return unit.toolCallIds;
  }
  if (unit.type === "subagent_group") {
    if (unit.waitToolCallId) {
      return [...unit.toolCallIds, unit.waitToolCallId];
    }
    return unit.toolCallIds;
  }
  if (unit.type === "item" && unit.item.kind === "tool") {
    return [unit.item.toolCallId];
  }
  return NO_TOOL_IDS;
}

/**
 * True when every card this row reads is the same object in both maps.
 * The maps themselves may differ. A patched card (new object) returns false
 * so that row re-renders; unrelated cards are not read.
 * @param unit Row whose ids are checked. Ids from a different unit would
 *   ignore a card this row actually paints.
 * @param previous Cards from the last paint.
 * @param next Cards for this paint.
 */
export function sameToolCardsForUnit(
  unit: TimelineRenderUnitWithTurns,
  previous: Record<string, ToolCallCard | undefined>,
  next: Record<string, ToolCallCard | undefined>,
): boolean {
  if (previous === next) {
    return true;
  }
  const ids = toolCallIdsInRenderUnit(unit);
  for (const id of ids) {
    if (previous[id] !== next[id]) {
      return false;
    }
  }
  return true;
}

/**
 * React.memo compare for {@link TimelineUnitRowWidget}.
 * Return true to skip the render. A false negative (returns false) only
 * costs a render; a false positive would leave a stale row on screen, so
 * unit identity and the row's own cards are both required.
 * @param previous Props from the last committed render.
 * @param next Props for the render React is considering.
 */
export function timelineUnitRowPropsEqual(
  previous: TimelineUnitRowWidgetProps,
  next: TimelineUnitRowWidgetProps,
): boolean {
  if (previous.unit !== next.unit) {
    return false;
  }
  if (previous.unitKey !== next.unitKey) {
    return false;
  }
  if (previous.live !== next.live) {
    return false;
  }
  if (previous.seeded !== next.seeded) {
    return false;
  }
  if (previous.sessionStatus !== next.sessionStatus) {
    return false;
  }
  if (previous.answerShowCursor !== next.answerShowCursor) {
    return false;
  }
  if (previous.compact !== next.compact) {
    return false;
  }
  if (previous.fallbackAnswer !== next.fallbackAnswer) {
    return false;
  }
  return sameToolCardsForUnit(previous.unit, previous.toolCalls, next.toolCalls);
}
