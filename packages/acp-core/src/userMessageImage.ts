/**
 * Apply agent-echoed image payloads from `user_message_chunk`.
 *
 * grok-build sends attachments as a separate chunk after the text echo:
 * `{ sessionUpdate: "user_message_chunk", content: { type: "image", mimeType, data } }`.
 * Without merging that binary onto the user row, session/load only has
 * `[Image #N]` placeholders and the timeline paints empty "image 1" chips.
 *
 * Pure — no I/O. Text absorb stays in `userMessageChunk.ts`.
 */

import type { ContentBlock, TimelineItem } from "./types.js";
import { nextTimelineId } from "./timelineId.js";
import { stripImagePlaceholders } from "./userEchoText.js";
import {
  isClaimableUserRow,
  userImagesFromBlocks,
} from "./userMessageChunk.js";

/** Image payload extracted from a user_message_chunk content object. */
export type UserChunkImage = {
  mimeType: string;
  /** Raw base64 without data: prefix. */
  data: string;
};

/**
 * Attach one agent-echoed image ContentBlock to the matching user row.
 *
 * Preference order: unconfirmed local/seed row still waiting for media, else
 * the last user row (text echo usually arrived first with `[Image #N]`). When
 * no user row exists yet (image-before-text on the wire), open an agent-origin
 * image-only row. Idempotent on identical base64 so session/load replay does
 * not stack duplicate thumbs.
 * @param timeline Current ordered timeline; not mutated in place.
 * @param image Mime + base64 payload already validated by the caller.
 * @returns Timeline with the image on the target user row.
 */
export function applyUserImageChunk(
  timeline: TimelineItem[],
  image: UserChunkImage,
): TimelineItem[] {
  const imageBlock: ContentBlock = {
    type: "image",
    mimeType: image.mimeType,
    data: image.data,
  };

  const targetIdx = findImageTargetIndex(timeline);

  if (targetIdx < 0) {
    return [
      ...timeline,
      {
        kind: "user",
        id: nextTimelineId("user"),
        blocks: [imageBlock],
        origin: "agent",
        agentConfirmed: false,
      },
    ];
  }

  const item = timeline[targetIdx];
  if (!item || item.kind !== "user") {
    return timeline;
  }

  // Same payload already on the row (reconnect / second session/load).
  if (
    item.blocks.some(
      (block) =>
        block.type === "image" &&
        block.data === image.data &&
        block.mimeType === image.mimeType,
    )
  ) {
    return timeline;
  }

  // Local/seed already painted binary thumbs — keep those bytes (often the
  // original pre-compress payload) and only clean `[Image #N]` noise from text.
  const localImages = userImagesFromBlocks(item.blocks);
  const authoritative =
    item.origin === "local" ||
    item.origin === "seed" ||
    Boolean(item.clientPromptId);
  if (authoritative && localImages.length > 0) {
    const cleaned = stripPlaceholderTextIfCovered(
      item.blocks,
      localImages.length,
    );
    if (cleaned === item.blocks) {
      return timeline;
    }
    return replaceTimelineItem(timeline, targetIdx, {
      ...item,
      blocks: cleaned,
    });
  }

  const withImage = [...item.blocks, imageBlock];
  const imageCount = userImagesFromBlocks(withImage).length;
  const blocks = stripPlaceholderTextIfCovered(withImage, imageCount);
  return replaceTimelineItem(timeline, targetIdx, {
    ...item,
    blocks,
  });
}

/**
 * Row that should receive this echoed image.
 *
 * Live: the first unconfirmed local/seed row is the prompt the agent is
 * echoing right now (queued prompts confirm in order), and its binary can
 * arrive before the text echo — so that row wins.
 *
 * session/load replay: every row is agent-origin and none of them ever reach
 * `agentConfirmed`, so a plain "first unconfirmed" search pins every image of
 * the transcript onto turn 1 and leaves later turns with bare `[Image #N]`
 * chips. The wire always sends a prompt's images right after its own text
 * echo, so the last user row is the correct slot there.
 * @param timeline Ordered timeline.
 * @returns Index of the target user row, or -1 when there is none.
 */
function findImageTargetIndex(timeline: TimelineItem[]): number {
  const pendingIdx = timeline.findIndex(
    (item) =>
      item.kind === "user" && !item.agentConfirmed && isClaimableUserRow(item),
  );
  return pendingIdx >= 0 ? pendingIdx : findLastUserItemIndex(timeline);
}

/**
 * Index of the last user row, or -1 when the timeline has no user messages.
 * @param timeline Ordered timeline.
 * @returns Index into `timeline`, or -1.
 */
function findLastUserItemIndex(timeline: TimelineItem[]): number {
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item && item.kind === "user") {
      return i;
    }
  }
  return -1;
}

/**
 * Drop `[Image #N]` stand-ins from text blocks once binary images cover them.
 * Leaves text unchanged when no placeholders remain or the array is already clean.
 * @param blocks User row blocks (may include images already).
 * @param imageCount Number of binary image blocks now on the row.
 * @returns Same reference when unchanged; otherwise blocks with cleaned text.
 */
function stripPlaceholderTextIfCovered(
  blocks: ContentBlock[],
  imageCount: number,
): ContentBlock[] {
  if (imageCount <= 0) {
    return blocks;
  }
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== "text") {
      return block;
    }
    const cleaned = stripImagePlaceholders(block.text);
    if (cleaned === block.text) {
      return block;
    }
    changed = true;
    return { type: "text" as const, text: cleaned };
  });
  return changed ? next : blocks;
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
  const next = timeline.slice();
  next[idx] = item;
  return next;
}
