/**
 * Client-side SessionState reduce for the post-relay bridge protocol.
 * Applies raw session_update messages with eventId set-based dedupe
 * (eventIds are non-monotonic under task_* reordering — never use a seq watermark).
 *
 * Full bridge snapshots (state / seed / replay_end session) must enter only via
 * {@link hydrateSessionBucket}, which always ownership-merges so Go empty
 * frames and Node reduced snapshots cannot wipe client orchestration maps.
 */

import {
  applySessionUpdate,
  createSessionState,
  EventIdDedupe,
  mergeBridgeSnapshot,
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
 * Options for {@link hydrateSessionBucket}.
 * Boolean third-arg call sites are intentionally unsupported so every entry
 * re-states clearDedupe intent at compile time.
 */
export type HydrateSessionBucketOpts = {
  /**
   * When true (default), clear the eventId ring after merge.
   * Pass false when preserving history under Go empty full-state frames so
   * live update dedupe stays continuous.
   */
  clearDedupe?: boolean;
  /**
   * When true, assign snapshot without ownership merge.
   * Only for intentional client body resets (replay_begin clearing timeline
   * before re-apply). Bridge full-state frames must leave this false/omitted.
   */
  replace?: boolean;
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
 * Apply one bridge full-state snapshot into the reduce bucket.
 * **Single entry for full-snapshot replacement** (seed / state / replay_end
 * session). Always ownership-merges via {@link mergeBridgeSnapshot} unless
 * `opts.replace` is set for intentional client body resets (replay_begin).
 * Direct `bucket.state = snapshot` from call sites bypasses field ownership and
 * has historically wiped subagents / goal on Node replay_end and Go empties.
 *
 * @param bucket Target bucket (client-reduced state may already hold cards).
 * @param snapshot Bridge or seed SessionState (may omit client-owned maps).
 * @param opts clearDedupe (default true); replace (default false = merge).
 * @returns Merged (or replaced) state now stored on the bucket.
 */
export function hydrateSessionBucket(
  bucket: SessionReduceBucket,
  snapshot: SessionState,
  opts: HydrateSessionBucketOpts = {},
): SessionState {
  const clearDedupe = opts.clearDedupe !== false;
  if (opts.replace) {
    bucket.state = snapshot;
  } else {
    bucket.state = mergeBridgeSnapshot(bucket.state, snapshot);
  }
  if (clearDedupe) {
    bucket.dedupe.clear();
  }
  return bucket.state;
}

/**
 * Canvas status after session/load replay_end.
 * Batch reduce of answer chunks leaves streaming residue; handshake and the
 * Go wire force idle so a finished transcript does not paint Responding.
 * Only a permission raised during load still needs the user.
 * @param status Authoritative status on the replay_end frame.
 * @returns Status safe to write onto the restored canvas.
 */
export function replayEndCanvasStatus(status: SessionStatus): SessionStatus {
  return status === "waiting_permission" ? status : "idle";
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
