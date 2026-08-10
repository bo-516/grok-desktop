/**
 * Pure timeline / session reducers for ACP session/update events.
 * No I/O — unit-tested entry points for UI and M0.
 *
 * Implementation is split by concern (apply / text-merge / tool card);
 * this module re-exports the public surface so callers stay stable.
 */

import type { SessionState, SessionUpdate } from "./types.js";

export { nextTimelineId, resetTimelineIdCounter } from "./timelineId.js";
export {
  applyUserMessageChunk,
  userImagesFromBlocks,
  userTextFromBlocks,
  type UserImageBlock,
} from "./userMessageChunk.js";
export {
  echoRepeatsBody,
  isHiddenFromScrollback,
  normalizeEchoBody,
  stripSystemReminders,
} from "./userEchoText.js";
export { patchToolCard } from "./timelineToolCard.js";
export {
  abandonUnconfirmedSeedContent,
  appendOrMergeAgentText,
  appendOrMergeText,
  appendOrMergeThought,
  finalizeLatestThought,
  isCompatibleSeedEcho,
  replaceTimelineItem,
  tryAbsorbEchoIntoSeedTextRow,
} from "./timelineTextMerge.js";
export { applySessionUpdate } from "./timelineApply.js";

/**
 * Extract a SessionUpdate from a session/update notification params object.
 * Accepts both `{ update: {...} }` and a bare update object.
 * @param params Notification params or bare update; invalid shapes → null.
 * @returns Typed update or null when sessionUpdate discriminant is missing.
 */
export function extractSessionUpdate(params: unknown): SessionUpdate | null {
  if (!params || typeof params !== "object") {
    return null;
  }
  const p = params as Record<string, unknown>;
  const update = (p.update ?? p) as Record<string, unknown>;
  if (!update || typeof update !== "object") {
    return null;
  }
  if (typeof update.sessionUpdate !== "string") {
    return null;
  }
  return update as SessionUpdate;
}

/**
 * Create an empty session state for a new or loaded session.
 * @param init Identity and optional workspace / model / mode seeds.
 * @returns Idle SessionState with empty timeline and toolCalls.
 */
export function createSessionState(init: {
  id: string;
  workspace?: string;
  model?: string;
  mode?: SessionState["mode"];
}): SessionState {
  return {
    id: init.id,
    workspace: init.workspace ?? "",
    model: init.model ?? "",
    mode: init.mode ?? "build",
    status: "idle",
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}
