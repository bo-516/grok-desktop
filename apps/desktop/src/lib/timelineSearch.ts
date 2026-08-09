/**
 * In-conversation search helpers (F-STREAM-14 / ⌘F).
 */

import type { TimelineItem } from "@grok-desktop/acp-core";

export type TimelineSearchHit = {
  itemId: string;
  kind: TimelineItem["kind"];
  snippet: string;
  index: number;
};

/**
 * Extract searchable text from a timeline item.
 * @param item Timeline row.
 */
export function timelineItemText(item: TimelineItem): string {
  if (item.kind === "user") {
    return item.blocks
      .map((b) => (b.type === "text" ? b.text : ""))
      .join(" ");
  }
  if (item.kind === "agent" || item.kind === "thought") {
    return item.text;
  }
  if (item.kind === "error") {
    return item.message;
  }
  if (item.kind === "tool") {
    return item.toolCallId;
  }
  return "";
}

/**
 * Find matches across timeline (case-insensitive).
 * @param timeline Session timeline.
 * @param query Search string.
 */
export function searchTimeline(
  timeline: TimelineItem[],
  query: string,
): TimelineSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const hits: TimelineSearchHit[] = [];
  timeline.forEach((item, index) => {
    const text = timelineItemText(item);
    if (text.toLowerCase().includes(q)) {
      const pos = text.toLowerCase().indexOf(q);
      const start = Math.max(0, pos - 24);
      const snippet = text.slice(start, start + 80);
      hits.push({
        itemId: item.id,
        kind: item.kind,
        snippet,
        index,
      });
    }
  });
  return hits;
}
