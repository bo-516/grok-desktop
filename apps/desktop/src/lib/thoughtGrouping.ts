/**
 * Collapse consecutive thought timeline units for readability (symmetric to toolGrouping).
 * Does not merge across tool / agent / user rows so turn order stays intact.
 */

import type { TimelineItem } from "@grok-desktop/acp-core";
import type { TimelineRenderUnit } from "./toolGrouping";

export type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

export type ThoughtGroupUnit = {
  type: "thought_group";
  /** Stable key for React lists (derived from the first thought id). */
  id: string;
  /** Timeline item ids in order. */
  itemIds: string[];
  /** Full thought items so expand can show each segment's body. */
  items: ThoughtItem[];
  /** Sum of (completedAt - startedAt) across segments with both timestamps; 0 when unknown. */
  totalMs: number;
  /** Segment count; UI may append "· N steps" when > 1. */
  count: number;
};

export type TimelineRenderUnitWithThoughts =
  | TimelineRenderUnit
  | ThoughtGroupUnit;

/**
 * Group consecutive thought items in an already tool-grouped unit list.
 * Single thoughts stay as `{ type: "item" }`; two or more adjacent become one thought_group.
 * @param units Output of {@link groupTimelineTools} (or any unit list with item/tool_group).
 * @returns Units with adjacent thoughts collapsed; non-thought units unchanged and never crossed.
 */
export function groupTimelineThoughts(
  units: TimelineRenderUnit[],
): TimelineRenderUnitWithThoughts[] {
  const out: TimelineRenderUnitWithThoughts[] = [];
  let i = 0;
  while (i < units.length) {
    const unit = units[i];
    if (unit === undefined) {
      break;
    }
    if (unit.type !== "item" || unit.item.kind !== "thought") {
      out.push(unit);
      i += 1;
      continue;
    }

    const items: ThoughtItem[] = [unit.item];
    let j = i + 1;
    while (j < units.length) {
      const next = units[j];
      if (
        next === undefined ||
        next.type !== "item" ||
        next.item.kind !== "thought"
      ) {
        break;
      }
      items.push(next.item);
      j += 1;
    }

    if (items.length === 1) {
      out.push(unit);
    } else {
      out.push({
        type: "thought_group",
        id: `thought-group-${unit.item.id}`,
        itemIds: items.map((item) => item.id),
        items,
        totalMs: sumThoughtDurationMs(items),
        count: items.length,
      });
    }
    i = j;
  }
  return out;
}

/**
 * Sum completed segment durations for group labels.
 * Segments missing startedAt or completedAt contribute 0 (still counted in `count`).
 * @param items Ordered thought segments in the group.
 * @returns Total milliseconds ≥ 0.
 */
export function sumThoughtDurationMs(items: ThoughtItem[]): number {
  let total = 0;
  for (const item of items) {
    if (
      typeof item.startedAt === "number" &&
      typeof item.completedAt === "number" &&
      item.completedAt >= item.startedAt
    ) {
      total += item.completedAt - item.startedAt;
    }
  }
  return total;
}
