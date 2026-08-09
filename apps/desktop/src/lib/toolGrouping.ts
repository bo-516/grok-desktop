/**
 * Collapse consecutive read/search/list tool cards for timeline readability (F-TOOL-06).
 */

import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { isCollapsibleToolKind } from "./diffReview";

export type TimelineRenderUnit =
  | { type: "item"; item: TimelineItem }
  | {
      type: "tool_group";
      id: string;
      toolCallIds: string[];
      kinds: string[];
      count: number;
    };

/**
 * Group consecutive collapsible tool timeline items into summary units.
 * Non-collapsible tools and other kinds stay as single items.
 * @param timeline Ordered timeline.
 * @param toolCalls Card map for kind lookup.
 */
export function groupTimelineTools(
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
): TimelineRenderUnit[] {
  const out: TimelineRenderUnit[] = [];
  let i = 0;
  while (i < timeline.length) {
    const item = timeline[i]!;
    if (item.kind !== "tool") {
      out.push({ type: "item", item });
      i += 1;
      continue;
    }
    const card = toolCalls[item.toolCallId];
    const kind = String(card?.kind ?? "");
    if (!isCollapsibleToolKind(kind)) {
      out.push({ type: "item", item });
      i += 1;
      continue;
    }
    const ids: string[] = [item.toolCallId];
    const kinds: string[] = [kind];
    let j = i + 1;
    while (j < timeline.length) {
      const next = timeline[j]!;
      if (next.kind !== "tool") {
        break;
      }
      const nextCard = toolCalls[next.toolCallId];
      const nextKind = String(nextCard?.kind ?? "");
      if (!isCollapsibleToolKind(nextKind)) {
        break;
      }
      ids.push(next.toolCallId);
      kinds.push(nextKind);
      j += 1;
    }
    if (ids.length === 1) {
      out.push({ type: "item", item });
    } else {
      out.push({
        type: "tool_group",
        id: `group-${item.id}`,
        toolCallIds: ids,
        kinds,
        count: ids.length,
      });
    }
    i = j;
  }
  return out;
}

/**
 * Human summary for a collapsed tool group.
 * @param kinds Kind list in order.
 * @param count Total cards.
 */
export function toolGroupSummary(kinds: string[], count: number): string {
  const unique = [...new Set(kinds.filter(Boolean))];
  const label = unique.length > 0 ? unique.join("/") : "read";
  return `${count} ${label} tools`;
}
