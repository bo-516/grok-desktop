/**
 * Single compose for tools → subagents → thoughts → turns grouping.
 * Timeline UI and change-set turn indexing must call this (not hand-nest the four).
 */

import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { groupTimelineSubagents } from "./subagentGrouping";
import { groupTimelineThoughts } from "./thoughtGrouping";
import { groupTimelineTools } from "./toolGrouping";
import {
  groupTimelineTurns,
  type TimelineRenderUnitWithTurns,
} from "./turnGrouping";

/**
 * Build top-level render units for the chat canvas / turn index.
 * Order is fixed: collapsible tools, spawn fan-out groups, consecutive
 * thoughts, then turns.
 * @param timeline Ordered session items (may be empty).
 * @param toolCalls Session tool-call map (kinds + vendor meta for grouping).
 * @returns User / turn / error units (plus rare residual work units if grouping is bypassed).
 */
export function buildTimelineRenderUnits(
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
): TimelineRenderUnitWithTurns[] {
  return groupTimelineTurns(
    groupTimelineThoughts(
      groupTimelineSubagents(groupTimelineTools(timeline, toolCalls), toolCalls),
    ),
  );
}

/**
 * Stable React key / identity for one top-level render unit.
 * Single source for the canvas `key` and for entrance-animation bookkeeping:
 * if the two ever disagreed, a row could remount without being recognised as
 * already-seen history and would replay its fade-in.
 * @param unit Top-level unit from {@link buildTimelineRenderUnits}; grouped
 *   units carry their own synthesised id, bare items key off the ACP item id.
 * @returns Key unique within one session's unit list (ids are session-scoped,
 *   so keys from two different sessions never collide in practice).
 */
export function timelineRenderUnitKey(
  unit: TimelineRenderUnitWithTurns,
): string {
  return unit.type === "item" ? unit.item.id : unit.id;
}
