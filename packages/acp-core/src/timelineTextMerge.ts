/**
 * Timeline text/thought merge + seed-row claim for session/load replay.
 * Pure helpers used by applySessionUpdate; never perform I/O.
 */

import type { TimelineItem } from "./types.js";
import { nextTimelineId } from "./timelineId.js";
import { applyUserMessageChunk } from "./userMessageChunk.js";

/**
 * Immutable replace of one timeline slot.
 * @param timeline Source array.
 * @param idx Index to replace.
 * @param item New item at idx.
 * @returns New array with `item` at `idx`.
 */
export function replaceTimelineItem(
  timeline: TimelineItem[],
  idx: number,
  item: TimelineItem,
): TimelineItem[] {
  return [...timeline.slice(0, idx), item, ...timeline.slice(idx + 1)];
}

/**
 * Close the last Thinking fragment that is still streaming.
 * @param timeline Current timeline; keeps the same reference when the tail is not an incomplete thought.
 * @param completedAt Optional end time; defaults to now when omitted.
 * @returns New list with end time marked, or the original list when no change is needed.
 */
export function finalizeLatestThought(
  timeline: TimelineItem[],
  completedAt = Date.now(),
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  if (!last || last.kind !== "thought" || last.completedAt !== undefined) {
    return timeline;
  }
  return [...timeline.slice(0, -1), { ...last, completedAt }];
}

/**
 * Whether an incoming chunk is compatible with claiming a seed agent/thought body.
 * Empty echo-acc must not treat arbitrary text as a cumulative resend of the seed.
 * @param existing Authoritative seed body text.
 * @param acc Prior accumulated echo for this slot (may be empty).
 * @param text Incoming non-empty chunk.
 * @returns True when the chunk continues or completes claim of this seed row.
 */
export function isCompatibleSeedEcho(
  existing: string,
  acc: string,
  text: string,
): boolean {
  // Equal, progressive prefix of seed, or longer superseding body.
  if (text === existing || existing.startsWith(text)) {
    return true;
  }
  if (text.startsWith(existing) && text.length > existing.length) {
    return true;
  }
  // Chunked append toward seed (acc + fragment).
  if (existing.startsWith(acc + text) || acc + text === existing) {
    return true;
  }
  // Cumulative full-message resend only after we already have related progress,
  // or when the full resend itself is still a prefix/equal of the seed body.
  if (acc.length > 0 && text.startsWith(acc)) {
    return true;
  }
  if (
    acc.length === 0 &&
    (existing.startsWith(text) || text.startsWith(existing))
  ) {
    return true;
  }
  return false;
}

/**
 * Try to absorb session/load echo into one seed agent/thought row.
 * On mismatch, abandons that slot (`agentConfirmed: true`, body unchanged) so a
 * later seed row or a live append can accept the chunk — never silent-drop.
 * @param timeline Full timeline (immutable update).
 * @param idx Index of the pending seed agent/thought item.
 * @param text Incoming chunk.
 * @returns `absorbed: true` when the chunk claimed progress on this slot;
 *          `absorbed: false` when the slot was abandoned for mismatch.
 */
export function tryAbsorbEchoIntoSeedTextRow(
  timeline: TimelineItem[],
  idx: number,
  text: string,
): { timeline: TimelineItem[]; absorbed: boolean } {
  const item = timeline[idx];
  if (!item || (item.kind !== "agent" && item.kind !== "thought")) {
    return { timeline, absorbed: false };
  }

  const existing = item.text;
  const acc = item.agentEchoAcc ?? "";

  if (!isCompatibleSeedEcho(existing, acc, text)) {
    const abandoned = {
      ...item,
      agentConfirmed: true as const,
    };
    return {
      timeline: replaceTimelineItem(timeline, idx, abandoned),
      absorbed: false,
    };
  }

  // Agent has a longer complete sentence than cached seed — adopt it.
  if (text.startsWith(existing) && text.length > existing.length) {
    const next = {
      ...item,
      text,
      agentEchoAcc: text,
      agentConfirmed: true as const,
    };
    return {
      timeline: replaceTimelineItem(timeline, idx, next),
      absorbed: true,
    };
  }

  let nextAcc = acc;
  // Cumulative resend of the same growing message (only when already related).
  if (acc.length > 0 && text.startsWith(acc) && text.length >= acc.length) {
    nextAcc = text;
  } else if (existing.startsWith(acc + text) || acc + text === existing) {
    nextAcc = acc + text;
  } else if (text === existing || existing.startsWith(text)) {
    // Full-message or progressive prefix replay of the authoritative body.
    if (text.length >= acc.length) {
      nextAcc = text;
    }
  } else {
    // Compatible only via longer-supersede path handled above; should not reach.
    const abandoned = { ...item, agentConfirmed: true as const };
    return {
      timeline: replaceTimelineItem(timeline, idx, abandoned),
      absorbed: false,
    };
  }

  const confirmed =
    nextAcc === existing ||
    (nextAcc.length >= existing.length && nextAcc.startsWith(existing));

  const next = {
    ...item,
    agentEchoAcc: nextAcc,
    agentConfirmed: confirmed,
  };
  return {
    timeline: replaceTimelineItem(timeline, idx, next),
    absorbed: true,
  };
}

/**
 * Mark every unconfirmed seed agent/thought as confirmed so a new local turn
 * cannot absorb into stale session/load slots (incomplete resume safety).
 * Seed bodies are preserved; only the claim latch flips.
 * @param timeline Current timeline; not mutated in place.
 * @returns Same reference when nothing changes; otherwise a new array.
 */
export function abandonUnconfirmedSeedContent(
  timeline: TimelineItem[],
): TimelineItem[] {
  let changed = false;
  const next = timeline.map((item) => {
    if (
      (item.kind === "agent" || item.kind === "thought") &&
      item.origin === "seed" &&
      !item.agentConfirmed
    ) {
      changed = true;
      return { ...item, agentConfirmed: true };
    }
    return item;
  });
  return changed ? next : timeline;
}

/** Result of applying one agent_message_chunk to the timeline. */
export type AgentTextMergeResult = {
  /** Updated timeline (immutable). */
  timeline: TimelineItem[];
  /**
   * True when a live (non-seed) agent row was created or extended.
   * Seed claim during session/load must not grow lastAgentText.
   */
  liveApplied: boolean;
};

/**
 * Merge agent text blocks (user path uses {@link applyUserMessageChunk}).
 * Claims unconfirmed seed agent rows on session/load replay instead of double-appending.
 * @param timeline Current timeline; not mutated in place.
 * @param kind Only `"agent"` is used by callers after user path split.
 * @param text Non-empty text; empty strings are filtered by the caller.
 * @returns New timeline array.
 */
export function appendOrMergeText(
  timeline: TimelineItem[],
  kind: "user" | "agent",
  text: string,
): TimelineItem[] {
  if (kind === "user") {
    return applyUserMessageChunk(timeline, text);
  }
  return appendOrMergeAgentText(timeline, text).timeline;
}

/**
 * Append or merge an agent_message_chunk with seed-row claim semantics.
 * Unconfirmed `origin: "seed"` agent rows absorb matching replay in order.
 * Non-matching chunks abandon the current seed slot (keep seed body) and either
 * claim a later seed agent or append a live agent row — never silent-drop.
 * @param timeline Current ordered timeline.
 * @param text Non-empty agent chunk.
 * @returns Timeline plus whether a live agent row was written (for lastAgentText).
 */
export function appendOrMergeAgentText(
  timeline: TimelineItem[],
  text: string,
): AgentTextMergeResult {
  let current = timeline;
  for (;;) {
    const pendingIdx = current.findIndex(
      (item) =>
        item.kind === "agent" &&
        item.origin === "seed" &&
        !item.agentConfirmed,
    );
    if (pendingIdx < 0) {
      break;
    }
    const result = tryAbsorbEchoIntoSeedTextRow(current, pendingIdx, text);
    current = result.timeline;
    if (result.absorbed) {
      return { timeline: current, liveApplied: false };
    }
    // Slot abandoned (mismatch); try the next unconfirmed seed agent.
  }

  const last = current[current.length - 1];
  if (last && last.kind === "agent" && last.origin !== "seed") {
    return {
      timeline: [...current.slice(0, -1), { ...last, text: last.text + text }],
      liveApplied: true,
    };
  }
  return {
    timeline: [
      ...current,
      {
        kind: "agent",
        id: nextTimelineId("agent"),
        text,
        origin: "agent",
      },
    ],
    liveApplied: true,
  };
}

/**
 * Merge consecutive reasoning chunks; claim unconfirmed seed thoughts on resume.
 * Non-matching chunks abandon the pending seed thought and start a live row so
 * incomplete session/load never permanently blocks later reasoning.
 * @param timeline Current ordered timeline.
 * @param text Non-empty reasoning text; empty text is filtered by the caller first.
 * @returns Updated Thought list; the first live block carries a start time and default collapsed flag.
 */
export function appendOrMergeThought(
  timeline: TimelineItem[],
  text: string,
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  // Live incomplete thought (including mid-stream origin agent / untagged).
  if (
    last &&
    last.kind === "thought" &&
    last.completedAt === undefined &&
    last.origin !== "seed"
  ) {
    return [...timeline.slice(0, -1), { ...last, text: last.text + text }];
  }

  let current = timeline;
  for (;;) {
    const pendingIdx = current.findIndex(
      (item) =>
        item.kind === "thought" &&
        item.origin === "seed" &&
        !item.agentConfirmed,
    );
    if (pendingIdx < 0) {
      break;
    }
    const result = tryAbsorbEchoIntoSeedTextRow(current, pendingIdx, text);
    current = result.timeline;
    if (result.absorbed) {
      return current;
    }
  }

  return [
    ...current,
    {
      kind: "thought",
      id: nextTimelineId("thought"),
      text,
      collapsed: true,
      startedAt: Date.now(),
      origin: "agent",
    },
  ];
}
