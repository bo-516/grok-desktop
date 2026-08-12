/**
 * Apply one `user_message_chunk` session/update to SessionState.
 *
 * Handles both text echoes (sanitized for harness noise) and binary image
 * content chunks. Kept separate from `timelineApply` so the main switch stays
 * under the line budget.
 */

import type { SessionState, SessionUpdate } from "./types.js";
import { applyUserMessageChunk } from "./userMessageChunk.js";
import { applyUserImageChunk } from "./userMessageImage.js";
import {
  isHiddenFromScrollback,
  sanitizeUserEchoText,
} from "./userEchoText.js";
import { finalizeLatestThought } from "./timelineTextMerge.js";

/**
 * Read text payload from chunk-style session updates without tight unions.
 * @param update Raw session update carrying optional content.text.
 * @returns Text string or empty when missing.
 */
function chunkText(update: SessionUpdate): string {
  const content = (update as { content?: { text?: unknown } }).content;
  if (!content || typeof content !== "object") {
    return "";
  }
  return typeof content.text === "string" ? content.text : "";
}

/**
 * Read a binary image payload from a user_message_chunk content object.
 * grok-build echoes attachments as separate chunks:
 * `{ type: "image", mimeType, data }` (base64, no data: prefix).
 * @param update Raw user_message_chunk update.
 * @returns Mime + base64 when both are present; null for text / empty / malformed.
 */
function readUserImageContent(
  update: SessionUpdate,
): { mimeType: string; data: string } | null {
  const content = (update as { content?: Record<string, unknown> }).content;
  if (!content || typeof content !== "object") {
    return null;
  }
  if (content.type !== "image") {
    return null;
  }
  const mimeType =
    typeof content.mimeType === "string" ? content.mimeType.trim() : "";
  const data = typeof content.data === "string" ? content.data : "";
  if (!mimeType || !data) {
    return null;
  }
  return { mimeType, data };
}

/**
 * Text of a user echo chunk that is allowed onto the canvas.
 * Drops hideFromScrollback noise; collapses goal / harness role packs.
 * @param update Raw user_message_chunk update.
 * @returns Displayable user text, or empty when the chunk is harness-only noise.
 */
function visibleUserChunkText(update: SessionUpdate): string {
  if (isHiddenFromScrollback(update)) {
    return "";
  }
  return sanitizeUserEchoText(chunkText(update));
}

/**
 * Close open Thinking before a visible user row is written.
 * @param state Current session snapshot.
 * @returns State with trailing incomplete thought finalized.
 */
function withFinalizedThought(state: SessionState): SessionState {
  return {
    ...state,
    timeline: finalizeLatestThought(state.timeline),
  };
}

/**
 * Apply one `user_message_chunk` (text and/or image content).
 * Image payloads have no text — must apply before the empty-text drop,
 * otherwise session/load loses thumbs and only `[Image #N]` remains.
 * @param state Current session; not mutated in place.
 * @param update Raw user_message_chunk update.
 * @returns New state, or the same reference when the chunk is dropped whole.
 */
export function applyUserMessageUpdate(
  state: SessionState,
  update: SessionUpdate,
): SessionState {
  const image = readUserImageContent(update);
  if (image) {
    const base = withFinalizedThought(state);
    return {
      ...base,
      timeline: applyUserImageChunk(base.timeline, image),
    };
  }
  const text = visibleUserChunkText(update);
  if (!text) {
    return state;
  }
  const base = withFinalizedThought(state);
  return {
    ...base,
    timeline: applyUserMessageChunk(base.timeline, text),
  };
}
