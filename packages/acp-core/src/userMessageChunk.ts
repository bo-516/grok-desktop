/**
 * Identity-based idempotent application of agent `user_message_chunk` events.
 * Keeps local/seed user bodies authoritative so session/load resume never doubles text.
 */

import type { ContentBlock, TimelineItem } from "./types.js";
import { nextTimelineId } from "./timelineId.js";
import { echoRepeatsBody, normalizeEchoBody } from "./userEchoText.js";

/**
 * Collapse a body that is one unit repeated back-to-back, as the pre-fix
 * seed+replay bug produced (`"hellohello"` → `"hello"`).
 *
 * Any repeat count collapses, not just pairs: a replayed turn gained one copy
 * per replay, so caches hold odd counts (`P+P+P`) that halving alone cannot
 * heal. Finding the shortest period covers every count in one pass.
 * @param text Raw user text body from cache or blocks.
 * @returns The single repeating unit, or `text` when it is not a clean repeat.
 */
export function collapseRepeatedText(text: string): string {
  const n = text.length;
  if (n < 2) {
    return text;
  }
  for (let unit = 1; unit <= n / 2; unit += 1) {
    if (n % unit !== 0) {
      continue;
    }
    const head = text.slice(0, unit);
    if (head.repeat(n / unit) === text) {
      return head;
    }
  }
  return text;
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
      // Compared on the normalized body: the re-echo carries the agent's own
      // rewrites (`[Image #N]`, reflowed spaces), and a literal compare would
      // read those as a brand-new message and open a duplicate bubble.
      if (echoRepeatsBody(text, userTextFromBlocks(lastUser.blocks))) {
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

  // Heal repeated bodies still present on older catalog rows before absorb.
  const cleanedBlocks = normalizeUserBlocks(item.blocks);
  const itemClean: Extract<TimelineItem, { kind: "user" }> =
    cleanedBlocks === item.blocks
      ? item
      : { ...item, blocks: cleanedBlocks };
  const timelineClean =
    itemClean === item
      ? timeline
      : replaceTimelineItem(timeline, pendingIdx, itemClean);

  // Local/seed rows with text and/or image blocks own the body. Image-only
  // prompts (empty text) must still absorb `[Image #N]` echoes here — otherwise
  // the agent-stream path appends placeholder text and the thumb can look "gone"
  // when the bubble reflows around raw stand-ins.
  const hasAuthoritativeBody =
    userTextFromBlocks(itemClean.blocks).length > 0 ||
    userImagesFromBlocks(itemClean.blocks).length > 0;
  if (authoritative && hasAuthoritativeBody) {
    return absorbEchoIntoAuthoritativeUser(
      timelineClean,
      pendingIdx,
      itemClean,
      text,
    );
  }

  // Agent-origin (or empty) streaming.
  //
  // These rows never reach agentConfirmed, so without the two guards below the
  // first one stays the absorb slot for the rest of the session: every extra
  // replay of the turn (reconnect, a second session/load, reopening the chat)
  // stacked another copy of the body, and a later turn's echo was concatenated
  // onto an unrelated message.
  const existing = userTextFromBlocks(item.blocks);
  const normExisting = normalizeEchoBody(existing);
  const normText = normalizeEchoBody(text);

  // Replay of what this row already holds: identical → nothing to do; longer →
  // the agent resent the whole message, so replace rather than concatenate.
  if (normExisting.length > 0 && normText.startsWith(normExisting)) {
    if (normText.length === normExisting.length) {
      return timeline;
    }
    return replaceTimelineItem(timeline, pendingIdx, {
      ...item,
      blocks: replaceTextBlocks(item.blocks, text),
      origin: item.origin ?? "agent",
      agentEchoAcc: text,
    });
  }

  // Only a row still at the tail is mid-message. Anything after it (an answer,
  // a tool card, a newer prompt) means that turn closed, so unrelated text
  // opens its own bubble instead of merging into the previous one.
  if (pendingIdx !== timeline.length - 1) {
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
  const hasImages = userImagesFromBlocks(item.blocks).length > 0;
  // Normalized twins of both sides: the agent echoes its own rewrite of the
  // prompt (image blocks become `[Image #N]`, whitespace reflows), so every
  // "is this the same message" decision below runs on the flattened form while
  // the stored body stays exactly what the person sent.
  const normExisting = normalizeEchoBody(existing);
  const normText = normalizeEchoBody(text);
  let acc = item.agentEchoAcc ?? "";

  // Image-only local prompt: agent echo is often only `[Image #N]` (normText
  // empty). Confirm without writing stand-ins into blocks.
  if (hasImages && normExisting.length === 0 && normText.length === 0) {
    const next: TimelineItem = {
      ...item,
      agentEchoAcc: text,
      agentConfirmed: true,
    };
    return replaceTimelineItem(timeline, idx, next);
  }

  // Agent has a longer complete sentence than optimistic local — adopt the
  // extra *normalized* wording only. Never store the raw echo: it carries
  // `[Image #N]` stand-ins that would replace a clean local body, and
  // replaceTextBlocks must keep image / resource blocks already on the row.
  if (
    normExisting.length > 0 &&
    normText.startsWith(normExisting) &&
    normText.length > normExisting.length
  ) {
    const next: TimelineItem = {
      ...item,
      // Extend with the normalized body (no image stand-ins) so binary image
      // blocks stay attached to the same user row.
      blocks: replaceTextBlocks(item.blocks, normText),
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
  } else if (normExisting.startsWith(normText) || (hasImages && !normText)) {
    // Full-message or progressive prefix replay of the authoritative body.
    // Empty normText with local images is the placeholder-only echo.
    if (text.length >= acc.length) {
      acc = text;
    }
  } else {
    // Chunk does not match this pending local/seed slot — leave it open and
    // do not corrupt blocks (agent may be mid-protocol anomaly).
    return timeline;
  }

  const normAcc = normalizeEchoBody(acc);
  const confirmed =
    (normExisting.length === 0 && hasImages && normAcc.length === 0) ||
    (normAcc.length >= normExisting.length &&
      (normExisting.length === 0 || normAcc.startsWith(normExisting)));

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

/** Image payload extracted for timeline / composer preview (base64, no data: prefix). */
export type UserImageBlock = {
  mimeType: string;
  data: string;
};

/**
 * Collect image ContentBlocks from a user prompt row (order preserved).
 * Resource / resource_link blocks stay out — they are agent payload only and
 * must not paint as raw type names in the bubble.
 * @param blocks User row blocks from appendUserPrompt / seed.
 * @returns Image slices with mime + base64 data; empty when none.
 */
export function userImagesFromBlocks(blocks: ContentBlock[]): UserImageBlock[] {
  const images: UserImageBlock[] = [];
  for (const block of blocks) {
    if (block.type !== "image") {
      continue;
    }
    if (!block.data || !block.mimeType) {
      continue;
    }
    images.push({ mimeType: block.mimeType, data: block.data });
  }
  return images;
}

/**
 * Collapse repeated text blocks in a user row (pre-fix catalog heal).
 * @param blocks User content blocks.
 * @returns Same array reference when unchanged; otherwise new blocks with cleaned text.
 */
function normalizeUserBlocks(blocks: ContentBlock[]): ContentBlock[] {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== "text") {
      return block;
    }
    const cleaned = collapseRepeatedText(block.text);
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
