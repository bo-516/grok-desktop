/**
 * Inbound bridge WebSocket message dispatch (relay reduce + load-replay batching).
 * Extracted from connectLiveBridge so unit tests can drive the shipped path
 * without a real WebSocket.
 *
 * During session/load replay (framed by replay_begin / replay_end):
 * - session_update mutates the per-session reduce bucket silently (no store notify)
 * - replay_end applies Node snapshot or Go updates once, overlays authoritative
 *   status/model/mode, and emits a single onState
 * Windows are per sessionId (I3). Open windows close on socket close / error /
 * ~20s timeout (I4). Missing replay_begin keeps per-update fan-out (I6).
 */

import type { SessionState, SessionUpdate } from "@grok-desktop/acp-core";
import {
  applySessionLifecycle,
  createSessionReduceBucket,
  hydrateSessionBucket,
  reduceSessionUpdate,
  type SessionReduceBucket,
} from "../lib/sessionReduce";
import type { BridgeServerMsg, LiveBridgeHandlers } from "./liveBridgeTypes";

/** Default max time a replay window may stay open before forced flush (ms). */
export const REPLAY_TIMEOUT_MS = 20_000;

/**
 * Injectable timers for tests (fake clock). Production uses global timers.
 */
export type ReplayDispatchClock = {
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};

/** Production clock. */
const defaultClock: ReplayDispatchClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

/** Open replay window bookkeeping for one session. */
type ReplayWindow = {
  /** Timeout handle that forces flush if the bridge never sends replay_end. */
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Options for createLiveBridgeDispatch.
 */
export type LiveBridgeDispatchOpts = {
  /** Handler callbacks (store paint, pool, errors, …). */
  handlers: LiveBridgeHandlers;
  /** Optional fake clock for timeout tests. */
  clock?: ReplayDispatchClock;
  /** Override replay silence timeout (default REPLAY_TIMEOUT_MS). */
  replayTimeoutMs?: number;
};

/**
 * Mutable reduce + replay state owned by one bridge connection.
 */
export type LiveBridgeDispatch = {
  /**
   * Handle one decoded BridgeServerMsg.
   * @param msg Server message (state / session_update / replay_* / …).
   * @returns true when the message was a relay/lifecycle type this module owns;
   *   false when the caller should continue with fs / cli / other types.
   */
  handleServerMsg: (msg: BridgeServerMsg) => boolean;
  /**
   * Seed the reduce bucket from a catalog/select snapshot before `start`.
   * Go pool hit never returns timeline; live updates must append onto this
   * base or the first chunk would replace the painted history with a stub.
   * @param session Catalog-seeded SessionState (may be empty on cold restore).
   */
  seedSession: (session: SessionState) => void;
  /**
   * Force-close every open replay window and paint once per session (I4).
   * Call on socket close / hard error.
   */
  flushAllReplays: () => void;
  /** Drop reduce buckets (socket close). */
  clearBuckets: () => void;
  /** Test/observe: session ids currently inside a replay window. */
  replayingSessionIds: () => string[];
  /** Test/observe: reduce bucket for a session id. */
  bucketFor: (sessionId: string) => SessionReduceBucket;
};

/**
 * Create the inbound message dispatcher used by connectLiveBridge.
 * @param opts Handlers + optional clock/timeout overrides.
 */
export function createLiveBridgeDispatch(
  opts: LiveBridgeDispatchOpts,
): LiveBridgeDispatch {
  const handlers = opts.handlers;
  const clock = opts.clock ?? defaultClock;
  const replayTimeoutMs = opts.replayTimeoutMs ?? REPLAY_TIMEOUT_MS;
  /** Per-session reduce state for the relay path. */
  const reduceBuckets = new Map<string, SessionReduceBucket>();
  /** Sessions currently inside a silent replay window (I3 isolation). */
  const replayingSessions = new Map<string, ReplayWindow>();

  /**
   * Resolve or create the reduce bucket for a session id.
   * @param sessionId ACP session id (empty ids share one provisional bucket).
   */
  function bucketFor(sessionId: string): SessionReduceBucket {
    const key = sessionId || "__pending__";
    let bucket = reduceBuckets.get(key);
    if (!bucket) {
      bucket = createSessionReduceBucket();
      reduceBuckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * Prefill reduce state from the UI catalog seed before bridge start.
   * Skips when the seed has no id. Never shrinks a richer live bucket.
   * @param session Catalog or selectSession snapshot.
   */
  function seedSession(session: SessionState): void {
    if (!session.id) {
      return;
    }
    const bucket = bucketFor(session.id);
    const seedLen = session.timeline?.length ?? 0;
    const liveLen = bucket.state.timeline?.length ?? 0;
    if (seedLen < liveLen) {
      return;
    }
    // Keep eventId ring empty so a subsequent session/load can re-apply.
    hydrateSessionBucket(bucket, { ...session, id: session.id }, true);
  }

  /**
   * Arm or replace the I4 timeout for a session's replay window.
   * @param sessionId Session whose window must eventually close.
   */
  function armReplayTimeout(sessionId: string): void {
    const prev = replayingSessions.get(sessionId);
    if (prev) {
      clock.clearTimeout(prev.timer);
    }
    const timer = clock.setTimeout(() => {
      // Bridge never closed the window — force one paint so the session is not mute.
      flushReplaySession(sessionId);
    }, replayTimeoutMs);
    replayingSessions.set(sessionId, { timer });
  }

  /**
   * Close one session's replay window and notify the store with current bucket state.
   * @param sessionId Session to flush.
   */
  function flushReplaySession(sessionId: string): void {
    const win = replayingSessions.get(sessionId);
    if (!win) {
      return;
    }
    clock.clearTimeout(win.timer);
    replayingSessions.delete(sessionId);
    const bucket = bucketFor(sessionId);
    if (sessionId && !bucket.state.id) {
      bucket.state = { ...bucket.state, id: sessionId };
    }
    handlers.onState(bucket.state);
  }

  /**
   * Close every open replay window (socket close / hard error).
   */
  function flushAllReplays(): void {
    const ids = [...replayingSessions.keys()];
    for (const id of ids) {
      flushReplaySession(id);
    }
  }

  /**
   * Apply authoritative lifecycle fields from replay_end (T7).
   * Batch reduce leaves status=streaming; finished sessions must land idle.
   * @param bucket Target reduce bucket.
   * @param msg replay_end payload.
   */
  function applyReplayEndAuthoritative(
    bucket: SessionReduceBucket,
    msg: Extract<BridgeServerMsg, { type: "replay_end" }>,
  ): SessionState {
    return applySessionLifecycle(bucket, {
      status: msg.status,
      model: msg.model,
      mode: msg.mode,
    });
  }

  /**
   * Handle one server message. Returns true when consumed by this dispatcher.
   * @param msg Decoded bridge message.
   */
  /**
   * Sessions that recently finished a load-replay batch. Go bridge still emits
   * a post-handshake `state` with an empty timeline (it never holds one); that
   * must not wipe the client-reduced history from replay_end.
   */
  const recentlyReplayed = new Set<string>();

  function handleServerMsg(msg: BridgeServerMsg): boolean {
    if (msg.type === "state") {
      // Authoritative hydrate: replace client reduce bucket then notify store.
      const sid = msg.session.id || "__pending__";
      const bucket = bucketFor(sid);
      const incoming = msg.session;
      const incomingEmpty = (incoming.timeline?.length ?? 0) === 0;
      /**
       * While session/load replay is open, Go may still emit empty full-state
       * snapshots. Closing the window + painting empty blanks the catalog seed
       * and aborts silent batching — ignore empty hydrates until replay_end.
       */
      if (msg.session.id && replayingSessions.has(msg.session.id) && incomingEmpty) {
        return true;
      }
      /**
       * Go path: bridge SessionState.timeline is always empty. After
       * replay_end (or any prior reduce for this id) the bucket already holds
       * the real body — merge lifecycle fields only and keep history.
       */
      const keepHistory =
        Boolean(incoming.id) &&
        incomingEmpty &&
        (bucket.state.timeline?.length ?? 0) > 0 &&
        (bucket.state.id === incoming.id ||
          recentlyReplayed.has(incoming.id) ||
          !bucket.state.id);
      const nextSession = keepHistory
        ? {
            ...incoming,
            timeline: bucket.state.timeline,
            toolCalls: bucket.state.toolCalls,
            lastAgentText:
              bucket.state.lastAgentText || incoming.lastAgentText || "",
            plan: incoming.plan ?? bucket.state.plan,
            title: incoming.title ?? bucket.state.title,
          }
        : incoming;
      // Keep eventId ring when preserving history so live updates still dedupe.
      hydrateSessionBucket(bucket, nextSession, !keepHistory);
      // If we had provisional empty-id bucket, re-key under real id.
      if (msg.session.id && reduceBuckets.has("__pending__")) {
        reduceBuckets.delete("__pending__");
        reduceBuckets.set(msg.session.id, bucket);
      }
      // Non-empty full hydrate ends any open replay for this session (I4-safe).
      const win = replayingSessions.get(msg.session.id);
      if (win) {
        clock.clearTimeout(win.timer);
        replayingSessions.delete(msg.session.id);
      }
      handlers.onState(nextSession);
      return true;
    }

    if (msg.type === "replay_begin") {
      armReplayTimeout(msg.sessionId);
      // Load replay re-applies the full transcript. Drop catalog seed body so
      // chunks are not double-appended on top of the cache (identity merge is
      // best-effort; a clean base is safer). Keep id / workspace / model.
      if (msg.sessionId) {
        const bucket = bucketFor(msg.sessionId);
        if ((bucket.state.timeline?.length ?? 0) > 0) {
          hydrateSessionBucket(
            bucket,
            {
              ...bucket.state,
              id: msg.sessionId,
              timeline: [],
              toolCalls: {},
              lastAgentText: "",
              plan: undefined,
            },
            true,
          );
        } else if (!bucket.state.id) {
          bucket.state = { ...bucket.state, id: msg.sessionId };
        }
      }
      return true;
    }

    if (msg.type === "session_update") {
      const bucket = bucketFor(msg.sessionId);
      // Ensure id is stamped before reduce so catalog upserts key correctly.
      if (msg.sessionId && !bucket.state.id) {
        bucket.state = { ...bucket.state, id: msg.sessionId };
      }
      const before = bucket.state;
      const next = reduceSessionUpdate(bucket, msg.update, msg.eventId);
      const applied = next !== before;
      // Silent reduce during load replay — bucket only, no store notify.
      if (replayingSessions.has(msg.sessionId)) {
        return true;
      }
      if (handlers.onSessionUpdate) {
        handlers.onSessionUpdate(next, {
          sessionId: msg.sessionId,
          eventId: msg.eventId,
          applied,
        });
      } else if (applied) {
        // Default: same paint path as full state when store did not wire relay.
        handlers.onState(next);
      }
      return true;
    }

    if (msg.type === "replay_end") {
      const bucket = bucketFor(msg.sessionId);
      if (msg.sessionId && !bucket.state.id) {
        bucket.state = { ...bucket.state, id: msg.sessionId };
      }
      const win = replayingSessions.get(msg.sessionId);
      if (win) {
        clock.clearTimeout(win.timer);
        replayingSessions.delete(msg.sessionId);
      }
      // Node path: already-reduced snapshot. Go path: ordered raw updates.
      if (msg.session) {
        hydrateSessionBucket(bucket, msg.session, true);
      } else {
        for (const item of msg.updates ?? []) {
          // Tolerate both {update,eventId} wire items and bare SessionUpdate.
          const update =
            item &&
            typeof item === "object" &&
            "update" in item &&
            item.update
              ? item.update
              : (item as unknown as SessionUpdate);
          const eventId =
            item && typeof item === "object" && "eventId" in item
              ? item.eventId
              : undefined;
          if (update && typeof update === "object" && "sessionUpdate" in update) {
            reduceSessionUpdate(bucket, update, eventId);
          }
        }
      }
      // T7: override batch-reduce streaming residue with authoritative lifecycle.
      const finalState = applyReplayEndAuthoritative(bucket, msg);
      if (msg.sessionId) {
        recentlyReplayed.add(msg.sessionId);
        // Drop the mark after a quiet window so a later true empty session can hydrate.
        clock.setTimeout(() => {
          recentlyReplayed.delete(msg.sessionId);
        }, 5_000);
      }
      handlers.onState(finalState);
      return true;
    }

    if (msg.type === "session_lifecycle") {
      const bucket = bucketFor(msg.sessionId);
      if (msg.sessionId && !bucket.state.id) {
        bucket.state = { ...bucket.state, id: msg.sessionId };
      }
      const next = applySessionLifecycle(bucket, {
        status: msg.status,
        pendingPermission: msg.pendingPermission,
        model: msg.model,
        mode: msg.mode,
      });
      if (handlers.onSessionUpdate) {
        handlers.onSessionUpdate(next, {
          sessionId: msg.sessionId,
          applied: true,
        });
      } else {
        handlers.onState(next);
      }
      return true;
    }

    if (msg.type === "pool") {
      handlers.onPool?.(msg.entries);
      return true;
    }
    if (msg.type === "environment") {
      handlers.onEnvironment?.(msg.env);
      return true;
    }
    if (msg.type === "info") {
      handlers.onInfo?.(msg.message, msg.sessionId);
      return true;
    }
    if (msg.type === "error") {
      // Hard error: if session-scoped and replaying, flush that window (I4).
      if (msg.sessionId && replayingSessions.has(msg.sessionId)) {
        flushReplaySession(msg.sessionId);
      }
      handlers.onError?.(msg.message, msg.sessionId);
      return true;
    }
    if (msg.type === "stderr") {
      handlers.onStderr?.(msg.text, msg.sessionId);
      return true;
    }
    if (msg.type === "hello") {
      handlers.onHello?.(msg.cwd, msg.poolCapacity, {
        impl: msg.impl,
        version: msg.version,
      });
      return true;
    }
    if (msg.type === "restart_required") {
      handlers.onRestartRequired?.(msg);
      return true;
    }

    return false;
  }

  return {
    handleServerMsg,
    seedSession,
    flushAllReplays,
    clearBuckets: () => {
      reduceBuckets.clear();
    },
    replayingSessionIds: () => [...replayingSessions.keys()],
    bucketFor,
  };
}

/**
 * Build a minimal SessionUpdate list for tests / fixtures (agent chunks).
 * @param n Number of agent_message_chunk updates.
 * @param sessionId Prefix for eventIds.
 */
export function makeAgentChunkUpdates(
  n: number,
  sessionId = "s1",
): { update: SessionUpdate; eventId: string }[] {
  const out: { update: SessionUpdate; eventId: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `w${i} ` },
      },
      eventId: `${sessionId}-${i + 1}`,
    });
  }
  return out;
}
