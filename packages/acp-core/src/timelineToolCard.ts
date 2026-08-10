/**
 * Tool-call card merge helpers for ACP session/update events.
 * Pure — no I/O; shared by timeline apply path and tests.
 */

import type { ToolCallCard } from "./types.js";

/**
 * Deep-ish merge for tool card patches.
 * - Undefined fields on the patch are ignored (do not wipe).
 * - `content` is only replaced when the patch explicitly provides content.
 * - Nested plain objects are merged one level; arrays replace when provided.
 * @param existing Prior card for this toolCallId, if any.
 * @param patch Partial fields; `toolCallId` is required and always wins.
 * @returns New card object (never mutates `existing`).
 */
export function patchToolCard(
  existing: ToolCallCard | undefined,
  patch: Partial<ToolCallCard> & { toolCallId: string },
): ToolCallCard {
  const base: ToolCallCard = existing
    ? { ...existing, meta: existing.meta ? { ...existing.meta } : undefined }
    : { toolCallId: patch.toolCallId };

  const next: ToolCallCard = { ...base, toolCallId: patch.toolCallId };

  if (patch.title !== undefined) {
    next.title = patch.title;
  }
  if (patch.kind !== undefined) {
    next.kind = patch.kind;
  }
  if (patch.status !== undefined) {
    next.status = patch.status;
  }
  if (patch.content !== undefined) {
    next.content = patch.content;
  }
  if (patch.rawLocations !== undefined) {
    next.rawLocations = patch.rawLocations;
  }
  if (patch.meta !== undefined) {
    next.meta = { ...(base.meta ?? {}), ...patch.meta };
  }

  // Preserve any extra agent fields stored under meta from raw updates
  return next;
}
