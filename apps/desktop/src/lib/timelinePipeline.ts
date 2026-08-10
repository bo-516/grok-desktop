/**
 * Single compose for tools → thoughts → turns grouping.
 * Timeline UI and change-set turn indexing must call this (not hand-nest the three).
 */

import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { groupTimelineThoughts } from "./thoughtGrouping";
import { groupTimelineTools } from "./toolGrouping";
import {
  groupTimelineTurns,
  type TimelineRenderUnitWithTurns,
} from "./turnGrouping";

/**
 * Build top-level render units for the chat canvas / turn index.
 * Order is fixed: collapsible tools, then consecutive thoughts, then turns.
 * @param timeline Ordered session items (may be empty).
 * @param toolCalls Session tool-call map (kinds for tool grouping).
 * @returns User / turn / error units (plus rare residual work units if grouping is bypassed).
 */
export function buildTimelineRenderUnits(
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
): TimelineRenderUnitWithTurns[] {
  return groupTimelineTurns(
    groupTimelineThoughts(groupTimelineTools(timeline, toolCalls)),
  );
}
