/**
 * Identity-based idempotent application of agent `user_message_chunk` events.
 * Keeps local/seed user bodies authoritative so session/load resume never doubles text.
 */

import type { ContentBlock, TimelineItem } from "./types.js";
import { nextTimelineId } from "./timelineId.js";

/**
 * Collapse exact doubled user text produced by the pre-fix seed+replay bug
 * (`"hellohello"` → `"hello"`). Repeats while the body is an exact X+X pair.
 * @param text Raw user text body from cache or blocks.
 * @returns Single-copy body when an exact double is detected; otherwise `text`.
 */
export function collapseExactDoubledText(text: string): string {
  let cur = text;
  while (cur.length >= 2 && cur.length % 2 === 0) {
    const half = cur.length / 2;
    if (cur.slice(0, half) !== cur.slice(half)) {
      break;
    }
    cur = cur.slice(0, half);
  }
  return cur;
}

/**
 * Apply one agent `user_message_chunk` with identity-based idempotency.
 * Unconfirmed local/seed user rows (in timeline order) absorb replay; blocks stay
 * authoritative for those rows so seed + session/load never doubles text.
 * Only pure agent-origin streaming concatenates into blocks.
 * @param timeline Current ordered timeline; not mutated in place.
 * @param text Non-empty chunk text; empty is filtered by the caller.
 * @returns New timeline; multi-turn resume and chunked replay leave user text byte-identical to seed/local.
 */
export function applyUserMessageChunk(
  timeline: TimelineItem[],
  text: string,
): TimelineItem[] {
  const pendingIdx = timeline.findIndex(
    (item) => item.kind === "user" && !item.agentConfirmed,
  );

  if (pendingIdx < 0) {
    // All user rows confirmed — discard late re-echo of the latest user body
    // (extra full-text session/load replay after chunked confirm).
    const lastUser = findLastUserItem(timeline);
    if (lastUser && lastUser.agentConfirmed) {
      const body = userTextFromBlocks(lastUser.blocks);
      if (
        text === body ||
        body.startsWith(text) ||
        text.startsWith(body)
      ) {
        return timeline;
      }
    }
    return [
      ...timeline,
      {
        kind: "user",
        id: nextTimelineId("user"),
        blocks: [{ type: "text", text }],
        origin: "agent",
        agentConfirmed: false,
        agentEchoAcc: text,
      },
    ];
  }

  const pending = timeline[pendingIdx];
  if (!pending || pending.kind !== "user") {
    return timeline;
  }
  const item: Extract<TimelineItem, { kind: "user" }> = pending;

  const authoritative =
    item.origin === "local" ||
    item.origin === "seed" ||
    Boolean(item.clientPromptId) ||
    // Untagged rows from older caches still act as seed during resume.
    item.origin === undefined;

  // Heal exact X+X bodies still present on older catalog rows before absorb.
  const cleanedBlocks = normalizeUserBlocks(item.blocks);
  const itemClean: Extract<TimelineItem, { kind: "user" }> =
    cleanedBlocks === item.blocks
      ? item
      : { ...item, blocks: cleanedBlocks };
  const timelineClean =
    itemClean === item
      ? timeline
      : replaceTimelineItem(timeline, pendingIdx, itemClean);

  if (authoritative && userTextFromBlocks(itemClean.blocks).length > 0) {
    return absorbEchoIntoAuthoritativeUser(
      timelineClean,
      pendingIdx,
      itemClean,
      text,
    );
  }

  // Agent-origin (or empty) streaming: append chunk text into blocks.
  const blocks = appendTextToBlocks(item.blocks, text);
  const acc = (item.agentEchoAcc ?? "") + text;
  const next: TimelineItem = {
    ...item,
    blocks,
    origin: item.origin ?? "agent",
    agentEchoAcc: acc,
  };
  return replaceTimelineItem(timeline, pendingIdx, next);
}

/**
 * Absorb agent echo into a local/seed user row without concatenating the body.
 * Confirms the row when the accumulated echo covers the authoritative text;
 * may extend blocks only when the agent sends a strictly longer full sentence.
 * @param timeline Full timeline (immutable update).
 * @param idx Index of the pending user item.
 * @param item Pending user item (kind already narrowed).
 * @param text Incoming chunk.
 * @returns Timeline with that user slot updated (or unchanged on discard).
 */
function absorbEchoIntoAuthoritativeUser(
  timeline: TimelineItem[],
  idx: number,
  item: Extract<TimelineItem, { kind: "user" }>,
  text: string,
): TimelineItem[] {
  const existing = userTextFromBlocks(item.blocks);
  let acc = item.agentEchoAcc ?? "";

  // Agent has a longer complete sentence than optimistic local — adopt it.
  if (text.startsWith(existing) && text.length > existing.length) {
    const next: TimelineItem = {
      ...item,
      blocks: replaceTextBlocks(item.blocks, text),
      agentEchoAcc: text,
      agentConfirmed: true,
    };
    return replaceTimelineItem(timeline, idx, next);
  }

  // Cumulative resend (agent grows the full message each time).
  if (text.startsWith(acc) && text.length >= acc.length) {
    acc = text;
  } else if (existing.startsWith(acc + text) || acc + text === existing) {
    acc = acc + text;
  } else if (text === existing || existing.startsWith(text)) {
    // Full-message or progressive prefix replay of the authoritative body.
    if (text.length >= acc.length) {
      acc = text;
    }
  } else {
    // Chunk does not match this pending local/seed slot — leave it open and
    // do not corrupt blocks (agent may be mid-protocol anomaly).
    return timeline;
  }

  const confirmed =
    acc === existing ||
    (acc.length >= existing.length && acc.startsWith(existing));

  const next: TimelineItem = {
    ...item,
    agentEchoAcc: acc,
    agentConfirmed: confirmed,
  };
  return replaceTimelineItem(timeline, idx, next);
}

/**
 * Join text from user content blocks (text parts only).
 * @param blocks User row blocks.
 * @returns Concatenated text body.
 */
export function userTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/**
 * Collapse exact X+X text blocks in a user row (pre-fix catalog heal).
 * @param blocks User content blocks.
 * @returns Same array reference when unchanged; otherwise new blocks with cleaned text.
 */
function normalizeUserBlocks(blocks: ContentBlock[]): ContentBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== "text") {
      return block;
    }
    const cleaned = collapseExactDoubledText(block.text);
    if (cleaned === block.text) {
      return block;
    }
    changed = true;
    return { type: "text" as const, text: cleaned };
  });
  return changed ? next : blocks;
}

/**
 * Find the last user timeline item (scan from end).
 * @param timeline Ordered timeline.
 * @returns Last user item or undefined.
 */
function findLastUserItem(
  timeline: TimelineItem[],
): Extract<TimelineItem, { kind: "user" }> | undefined {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item && item.kind === "user") {
      return item;
    }
  }
  return undefined;
}

/**
 * Append a text fragment onto the last text block, or push a new text block.
 * Used only for pure agent-origin streaming (not local/seed absorb).
 * @param blocks Existing blocks.
 * @param text Non-empty fragment.
 */
function appendTextToBlocks(
  blocks: ContentBlock[],
  text: string,
): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === "text") {
    return [...blocks.slice(0, -1), { type: "text", text: last.text + text }];
  }
  return [...blocks, { type: "text", text }];
}

/**
 * Replace the first text block body (or set a single text block).
 * @param blocks Existing blocks.
 * @param text Full replacement text.
 */
function replaceTextBlocks(
  blocks: ContentBlock[],
  text: string,
): ContentBlock[] {
  const textIdx = blocks.findIndex((b) => b.type === "text");
  if (textIdx < 0) {
    return [{ type: "text", text }, ...blocks];
  }
  const next = [...blocks];
  next[textIdx] = { type: "text", text };
  return next;
}

/**
 * Immutable replace of one timeline slot.
 * @param timeline Source array.
 * @param idx Index to replace.
 * @param item New item at idx.
 */
function replaceTimelineItem(
  timeline: TimelineItem[],
  idx: number,
  item: TimelineItem,
): TimelineItem[] {
  return [...timeline.slice(0, idx), item, ...timeline.slice(idx + 1)];
}
