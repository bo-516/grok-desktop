/**
 * Sanitizers for agent-echoed user text (`user_message_chunk`).
 *
 * grok-build replays a prompt as the *agent* received it, not as the person
 * typed it, and two rewrites leak into the canvas if left alone:
 *
 * 1. Harness `<system-reminder>` notices (background-task completions, hook
 *    output) arrive as their own user chunks flagged `_meta.hideFromScrollback`.
 *    Rendering them turns the user bubble into a log dump.
 * 2. Attached images come back as `[Image #N]` placeholders. Comparing the raw
 *    echo against the local body then fails, so the optimistic row never
 *    confirms and the next replay appends a duplicate bubble.
 *
 * Pure string helpers — no state, no I/O, no DOM. Used by the timeline reducer
 * before an echo may be stored, and by seed tagging to heal caches written
 * before this filter existed.
 */

import type { SessionUpdate } from "./types.js";

/** Complete `<system-reminder>…</system-reminder>` block, including newlines. */
const REMINDER_SPAN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Orphan close tag: chunk started inside a reminder, so drop everything up to it. */
const REMINDER_CLOSE_HEAD = /^[\s\S]*?<\/system-reminder>/;

/** Unterminated open tag: reminder ran past the end of this chunk. */
const REMINDER_OPEN_TAIL = /<system-reminder>[\s\S]*$/;

/** Agent stand-in for an image ContentBlock in the echoed prompt. */
const IMAGE_PLACEHOLDER = /\[Image\s*#\d+\]/g;

/**
 * Read a nested `_meta` record without asserting the whole update shape.
 * @param value Update or content object that may carry `_meta`.
 * @returns The `_meta` record, or null when absent / not an object.
 */
function metaOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const meta = (value as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") {
    return null;
  }
  return meta as Record<string, unknown>;
}

/**
 * Whether the agent itself marked this update as not-for-transcript.
 * grok-build sets `_meta.hideFromScrollback` on injected reminder chunks; it is
 * the authoritative signal, so honoring it is cheaper and safer than guessing
 * from the text. Checked on the update and on its content (agents differ on
 * which level carries the flag); a missing flag means "show it".
 * @param update Session update already extracted by extractSessionUpdate.
 * @returns true when the chunk must never reach the timeline.
 */
export function isHiddenFromScrollback(update: SessionUpdate): boolean {
  const own = metaOf(update);
  if (own?.hideFromScrollback === true) {
    return true;
  }
  const content = metaOf((update as { content?: unknown }).content);
  return content?.hideFromScrollback === true;
}

/**
 * Remove harness `<system-reminder>` blocks from echoed user text.
 * Handles complete blocks plus the two split-chunk shapes (leading orphan close
 * tag, trailing unterminated open tag) so a reminder that straddles a chunk
 * boundary cannot leave half a log in the bubble. Blank runs left behind are
 * collapsed and the result trimmed.
 * @param text Raw chunk text or a cached user block body.
 * @returns Text with reminders removed; empty string when the input was only
 *   reminder content, which callers must treat as "drop this chunk".
 */
export function stripSystemReminders(text: string): string {
  if (!text.includes("system-reminder")) {
    return text;
  }
  return text
    .replace(REMINDER_SPAN, "")
    .replace(REMINDER_CLOSE_HEAD, "")
    .replace(REMINDER_OPEN_TAIL, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Comparison form of a user body: agent rewrites removed, whitespace flattened.
 *
 * Only ever used to decide whether an echo *is* the local text — never stored
 * and never rendered, so flattening here cannot alter what the person sees.
 * Without it, `[Image #1]` and a reflowed space make an identical message look
 * like a new one, which is what duplicated the bubble.
 * @param text Local body, accumulated echo, or an incoming chunk.
 * @returns Normalized body for prefix / equality checks.
 */
export function normalizeEchoBody(text: string): string {
  return stripSystemReminders(text)
    .replace(IMAGE_PLACEHOLDER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether an echo chunk is just a replay of a body already on the canvas.
 * Prefix-tolerant in both directions so partial replays (agent still streaming)
 * and padded replays both count as "already shown".
 * @param echo Incoming chunk text.
 * @param body Text of the user row it might belong to.
 * @returns true when the chunk adds nothing new and must be discarded.
 */
export function echoRepeatsBody(echo: string, body: string): boolean {
  const a = normalizeEchoBody(echo);
  const b = normalizeEchoBody(body);
  if (!a) {
    return true;
  }
  return a === b || b.startsWith(a) || a.startsWith(b);
}
