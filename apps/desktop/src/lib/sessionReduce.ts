/**
 * Client-side SessionState reduce for the post-relay bridge protocol.
 * Applies raw session_update messages with eventId set-based dedupe
 * (eventIds are non-monotonic under task_* reordering — never use a seq watermark).
 */

import {
  applySessionUpdate,
  createSessionState,
  EventIdDedupe,
  type SessionState,
  type SessionStatus,
  type SessionUpdate,
  type PermissionRequest,
  type AgentMode,
} from "@grok-desktop/acp-core";

/** Per-session reduce bookkeeping held by the live bridge connection. */
export type SessionReduceBucket = {
  state: SessionState;
  dedupe: EventIdDedupe;
};

/**
 * Apply one raw ACP update if its eventId has not been seen.
 * @param bucket Per-session state + dedupe ring.
 * @param update SessionUpdate from bridge session_update.
 * @param eventId Optional wire eventId for set dedupe.
 * @returns Next state when applied, or the same state when deduped.
 */
export function reduceSessionUpdate(
  bucket: SessionReduceBucket,
  update: SessionUpdate,
  eventId?: string | null,
): SessionState {
  if (!bucket.dedupe.accept(eventId)) {
    return bucket.state;
  }
  const next = applySessionUpdate(bucket.state, update);
  bucket.state = next;
  return next;
}

/**
 * Replace the bucket with a full hydrate snapshot (start / reconnect / get_state).
 * Clears the eventId ring so a subsequent replay of the same stream can be
 * re-applied if the bridge re-sends updates after hydrate (caller may also
 * re-seed eventIds if it knows them).
 * @param bucket Target bucket.
 * @param session Authoritative SessionState from bridge.
 * @param clearDedupe When true (default), drop seen eventIds after replace.
 */
export function hydrateSessionBucket(
  bucket: SessionReduceBucket,
  session: SessionState,
  clearDedupe = true,
): SessionState {
  bucket.state = session;
  if (clearDedupe) {
    bucket.dedupe.clear();
  }
  return bucket.state;
}

/**
 * Patch lifecycle fields without touching timeline/toolCalls.
 * @param bucket Per-session bucket.
 * @param patch Status / permission / model / mode from session_lifecycle.
 */
export function applySessionLifecycle(
  bucket: SessionReduceBucket,
  patch: {
    status: SessionStatus;
    pendingPermission?: PermissionRequest | null;
    model?: string;
    mode?: AgentMode;
  },
): SessionState {
  const next: SessionState = {
    ...bucket.state,
    status: patch.status,
  };
  if (patch.pendingPermission === null) {
    next.pendingPermission = undefined;
  } else if (patch.pendingPermission !== undefined) {
    next.pendingPermission = patch.pendingPermission;
  }
  if (patch.model !== undefined) {
    next.model = patch.model;
  }
  if (patch.mode !== undefined) {
    next.mode = patch.mode;
  }
  bucket.state = next;
  return next;
}

/**
 * Create an empty reduce bucket for a new session id.
 * @param seed Optional initial state (empty session if omitted).
 */
export function createSessionReduceBucket(
  seed?: SessionState,
): SessionReduceBucket {
  return {
    state: seed ?? createSessionState({ id: "", workspace: "" }),
    dedupe: new EventIdDedupe(),
  };
}
