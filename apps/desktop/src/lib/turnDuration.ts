/**
 * Wall-clock duration for a turn activity rail from nested thought timestamps.
 * Tools have no protocol clocks; missing timestamps degrade to 0 (no fabricated seconds).
 */

import type { TimelineItem } from "@grok-desktop/acp-core";
import type { TurnActivityChild } from "./turnGrouping";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

/**
 * Earliest thought startedAt nested in turn activity (if any).
 * Used for live wall-clock capture when a turn finishes after long tool runs.
 * @param activity Rail children in order.
 * @returns Epoch ms, or undefined when no thought clocks exist.
 */
export function turnEarliestStartMs(
  activity: TurnActivityChild[],
): number | undefined {
  let minStart = Number.POSITIVE_INFINITY;
  for (const child of activity) {
    for (const thought of collectThoughts(child)) {
      if (typeof thought.startedAt === "number") {
        minStart = Math.min(minStart, thought.startedAt);
      }
    }
  }
  return Number.isFinite(minStart) ? minStart : undefined;
}

/**
 * Wall-clock span across all thought timestamps nested in turn activity.
 * @param activity Rail children in order.
 * @returns Milliseconds ≥ 0; 0 when no usable thought clocks exist.
 */
export function turnWallDurationMs(activity: TurnActivityChild[]): number {
  let maxEnd = Number.NEGATIVE_INFINITY;
  const minStart = turnEarliestStartMs(activity);
  if (minStart === undefined) {
    return 0;
  }
  for (const child of activity) {
    for (const thought of collectThoughts(child)) {
      if (typeof thought.completedAt === "number") {
        maxEnd = Math.max(maxEnd, thought.completedAt);
      }
    }
  }
  if (!Number.isFinite(maxEnd) || maxEnd < minStart) {
    return 0;
  }
  return maxEnd - minStart;
}

/**
 * Collect thought items from a rail child (single thought or thought_group).
 * @param child Nested activity unit.
 */
function collectThoughts(child: TurnActivityChild): ThoughtItem[] {
  if (child.type === "thought_group") {
    return child.items;
  }
  if (child.type === "item" && child.item.kind === "thought") {
    return [child.item];
  }
  return [];
}
