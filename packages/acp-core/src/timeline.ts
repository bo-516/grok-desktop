/**
 * Pure timeline / session reducers for ACP session/update events.
 * No I/O — unit-tested entry points for UI and M0.
 *
 * Implementation is split by concern (apply / text-merge / tool card);
 * this module re-exports the public surface so callers stay stable.
 */

import type { SessionState, SessionUpdate } from "./types.js";
import {
  applyLiveContextOccupancy,
  stampLiveContextTokens,
} from "./sessionTokenUsage.js";
import { applySessionUpdateKind } from "./timelineApply.js";

export { nextTimelineId, resetTimelineIdCounter } from "./timelineId.js";
export {
  applyUserMessageChunk,
  userImagesFromBlocks,
  userTextFromBlocks,
  type UserImageBlock,
} from "./userMessageChunk.js";
export {
  applyUserImageChunk,
  type UserChunkImage,
} from "./userMessageImage.js";
export {
  countImagePlaceholders,
  echoRepeatsBody,
  extractGoalIntentLine,
  isHiddenFromScrollback,
  looksLikeHarnessRolePrompt,
  normalizeEchoBody,
  sanitizeUserEchoText,
  stripImagePlaceholders,
  stripSystemReminders,
  summarizeHarnessRolePrompt,
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
export {
  applyOrchestrationUpdate,
  isOrchestrationUpdate,
} from "./timelineOrchestration.js";
export {
  applyLiveContextOccupancy,
  contextTokensForWindow,
  contextUsagePercent,
  mergeTurnUsagePreservingOccupancy,
  parsePromptResultUsage,
  parseTurnCompletedUsage,
  parseUsageBag,
  readLiveContextTokens,
  stampLiveContextTokens,
  turnCompletedUpdateFromUsage,
  type SessionTokenUsage,
} from "./sessionTokenUsage.js";
export {
  hasLiveContextOccupancy,
  parseTokenUsageRpc,
  parseUsageUpdate,
} from "./sessionTokenUsageRpc.js";
export {
  SPAWN_SUBAGENT_TOOL,
  WAIT_SUBAGENT_TOOL,
  KILL_SUBAGENT_TOOL,
  flattenToolText,
  vendorToolName,
  isSpawnSubagentCard,
  isWaitSubagentCard,
  isKillSubagentCard,
  parseSpawnedSubagentId,
  waitBarrierTaskIds,
  sanitizeToolRawInput,
  spawnCardDescription,
  spawnCardType,
  linkSpawnCardIfReady,
  readToolMeta,
  readToolRawInput,
} from "./subagentLink.js";

/**
 * Extract a SessionUpdate from a session/update notification params object.
 * Accepts both `{ update: {...} }` and a bare update object.
 * Copies `params._meta.totalTokens` onto the update so relay (which forwards
 * only the inner update) still carries live context occupancy.
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
  // Bare-update callers pass the update as params; p._meta is then the
  // update's own meta (tool vendor bag). Only stamp from the envelope
  // when `update` is a nested field — otherwise we would copy tool meta.
  const paramsMeta = Object.prototype.hasOwnProperty.call(p, "update")
    ? p._meta
    : undefined;
  return stampLiveContextTokens(update, paramsMeta) as SessionUpdate;
}

/**
 * Immutably apply one ACP `session/update`, then merge live occupancy.
 * Kind reduce lives in applySessionUpdateKind; occupancy is applied here so
 * every return path (including early no-ops) can still refresh the ring.
 * @param state Current session snapshot; not mutated in place.
 * @param update Event already extracted by extractSessionUpdate.
 * @returns New session state shared by UI, bridge, and tests.
 */
export function applySessionUpdate(
  state: SessionState,
  update: SessionUpdate,
): SessionState {
  return applyLiveContextOccupancy(
    applySessionUpdateKind(state, update),
    update as { _meta?: unknown },
  );
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
