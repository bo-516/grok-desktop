/**
 * Pure fingerprint for timeline stick-to-bottom / content growth.
 * Kept out of React widgets so unit tests can import without mounting hooks.
 */

import type { TimelineItem } from "@grok-desktop/acp-core";

/**
 * Fingerprint timeline growth so stick-to-bottom can follow streams without
 * deep-comparing the whole item list.
 *
 * Wire / go-bridge snapshots may omit empty `lastAgentText` (JSON omitempty) or
 * ship a partial agent row without `text`. Never throw on missing fields —
 * this runs during render via useMemo.
 *
 * @param timeline Ordered session items (may be empty).
 * @param status Session run status (affects generating row).
 * @param lastAgentText Latest agent buffer (grows on each chunk while streaming).
 *   Missing/undefined is treated as "" (common after empty omitempty hydrate).
 * @param toolStatusSig Compact tool status map so in-place tool updates still pin-follow.
 * @returns Stable-enough string key; empty timeline → status-only key.
 */
export function timelineContentKey(
  timeline: TimelineItem[],
  status: string,
  lastAgentText: string | undefined | null,
  toolStatusSig: string,
): string {
  const agentBuf = lastAgentText ?? "";
  const last = timeline[timeline.length - 1];
  if (!last) {
    return `0:${status}`;
  }
  let tail: string | number = last.id;
  if (last.kind === "agent" || last.kind === "thought") {
    // Seed / partial rows can lack text until the first chunk lands.
    tail = last.text?.length ?? 0;
  }
  return `${timeline.length}:${last.kind}:${tail}:${status}:${agentBuf.length}:${toolStatusSig}`;
}
