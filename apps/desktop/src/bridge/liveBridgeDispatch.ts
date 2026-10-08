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
 *
 * Window timers live in liveBridgeReplay; handler-only messages route through
 * liveBridgeNotices. This module keeps the reduce buckets and SessionState routing.
 *
 * Live streaming (opt-in `coalesce`, on in connectLiveBridge): each
 * session_update still reduces immediately, but the store notify is
 * coalesced by liveBridgeCoalesce (per frame / background lane). Urgent
 * transitions notify at once, and every other notify this module makes
 * (state, lifecycle, replay boundaries, notices) first drains pending ones
 * so the store sees bucket changes in arrival order.
 *
 * Bridge stream positions (epoch/seq) and provenance are checked first by
 * liveBridgeStreamControl: duplicates drop, a gap drains the coalescer and
 * requests `resync`, whose frames re-enter here in order.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  applySessionLifecycle,
  createSessionReduceBucket,
  hydrateSessionBucket,
  reduceSessionUpdate,
  type SessionReduceBucket,
} from "../lib/sessionReduce";
import {
  applyReplayEndAuthoritative,
  createReplayWindowTracker,
  reduceReplayEndUpdates,
  REPLAY_TIMEOUT_MS,
  type ReplayDispatchClock,
} from "./liveBridgeReplay";
import { routeBridgeNotice } from "./liveBridgeNotices";
import {
  createStreamCoalescer,
  needsImmediateFlush,
  type LiveStreamCoalesceOpts,
} from "./liveBridgeCoalesce";
import type { BridgeServerMsg, LiveBridgeHandlers } from "./liveBridgeTypes";
import { createStreamControl } from "./liveBridgeStreamControl";

export { REPLAY_TIMEOUT_MS, type ReplayDispatchClock };

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
  /**
   * Coalesce live stream notifies (connectLiveBridge always passes it).
   * Omitted → every session_update notifies synchronously, which unit
   * tests rely on to observe each frame.
   */
  coalesce?: LiveStreamCoalesceOpts;
  /**
   * Send `resync` / `get_state` for the sequence gate (connectLiveBridge
   * passes its socket send). Omitted → gaps re-anchor locally only.
   */
  sendRequest?: (msg: Record<string, unknown>) => boolean;
  /** Override the resync answer timeout (liveBridgeStreamGate default). */
  resyncTimeoutMs?: number;
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
  /**
   * Emit every coalesced stream notify now (socket close, session switch,
   * disconnect). No-op without `coalesce` or when nothing is pending.
   */
  flushPendingUpdates: () => void;
  /** Drop reduce buckets (socket close); flushes pending notifies first. */
  clearBuckets: () => void;
  /** Test/observe: session ids with a coalesced notify still pending. */
  pendingUpdateIds: () => string[];
  /** Test/observe: session ids currently inside a replay window. */
  replayingSessionIds: () => string[];
  /** Test/observe: reduce bucket for a session id. */
  bucketFor: (sessionId: string) => SessionReduceBucket;
  /**
   * Remember a `start` request id sent on this connection, so the bridge's
   * echo marks that session's provenance `own`.
   * @param startId Client-generated id included in the start message.
   */
  noteOwnStart: (startId: string) => void;
  /** Test/observe: stream keys with a resync in flight. */
  pendingResyncs: () => string[];
};

/**
 * Create the inbound message dispatcher used by connectLiveBridge.
 * @param opts Handlers + optional clock/timeout overrides.
 */
export function createLiveBridgeDispatch(
  opts: LiveBridgeDispatchOpts,
): LiveBridgeDispatch {
  const handlers = opts.handlers;
  /** Per-session reduce state for the relay path. */
  const reduceBuckets = new Map<string, SessionReduceBucket>();
  /** Silent replay windows + recently-replayed marks for this connection. */
  const replayWindows = createReplayWindowTracker({
    clock: opts.clock,
    timeoutMs: opts.replayTimeoutMs ?? REPLAY_TIMEOUT_MS,
    onFlush: paintFlushedReplay,
  });
  /** Live stream coalescer; null keeps the synchronous notify path. */
  const stream = opts.coalesce
    ? createStreamCoalescer({ ...opts.coalesce, emit: emitCoalesced })
    : null;
  /** Provenance + seq/epoch gate (duplicates drop, gaps resync, fallback). */
  const control = createStreamControl({
    handlers,
    clock: opts.clock,
    send: opts.sendRequest,
    flush: () => stream?.flushAll(),
    replay: (frame) => handleServerMsg(frame),
    resyncTimeoutMs: opts.resyncTimeoutMs,
  });

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
    // Ownership merge: catalog seed must not wipe richer live orchestration.
    // Clear eventId ring so a subsequent session/load can re-apply.
    hydrateSessionBucket(
      bucket,
      { ...session, id: session.id },
      { clearDedupe: true },
    );
  }

  /**
   * Notify the store with a force-closed window's bucket (timeout / error /
   * socket close). Stamps the id first so catalog upserts key correctly.
   * @param sessionId Session whose window the tracker just closed.
   */
  function paintFlushedReplay(sessionId: string): void {
    const bucket = bucketFor(sessionId);
    if (sessionId && !bucket.state.id) {
      bucket.state = { ...bucket.state, id: sessionId };
    }
    handlers.onState(bucket.state, { recency: "passive" });
  }

  /**
   * Relay notify: onSessionUpdate when wired, else the onState paint path
   * (skipped for deduped frames, which changed nothing).
   * @param sessionId Wire session id (meta for the store).
   * @param session Post-reduce state to paint.
   * @param eventId Wire eventId, when the frame carried one.
   * @param applied False when dedupe dropped the frame.
   */
  function notifySessionUpdate(
    sessionId: string,
    session: SessionState,
    eventId: string | undefined,
    applied: boolean,
  ): void {
    if (handlers.onSessionUpdate) {
      handlers.onSessionUpdate(session, { sessionId, eventId, applied });
    } else if (applied) {
      handlers.onState(session);
    }
  }

  /**
   * Coalescer emit: paint the bucket's *current* state, so seeds / hydrates
   * that landed after the defer are included rather than overwritten.
   * @param sessionId Session whose notify is due.
   * @param eventId Latest eventId folded into the notify.
   */
  function emitCoalesced(sessionId: string, eventId: string | undefined): void {
    notifySessionUpdate(sessionId, bucketFor(sessionId).state, eventId, true);
  }

  /**
   * Handle one server message. Returns true when consumed by this dispatcher.
   * @param msg Decoded bridge message.
   */
  function handleServerMsg(msg: BridgeServerMsg): boolean {
    // Sequence seam: resync answers, duplicates and gap frames stop here.
    if (control.intercept(msg)) {
      return true;
    }
    if (msg.type === "state") {
      // Drain pending notifies first (also covers the "__pending__" re-key).
      stream?.flushAll();
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
      if (msg.session.id && replayWindows.isOpen(msg.session.id) && incomingEmpty) {
        return true;
      }
      /**
       * Full-state frames ownership-merge via hydrateSessionBucket so empty
       * Go hydrates and thin Node snapshots never wipe client orchestration.
       * @see mergeBridgeSnapshot / SESSION_FIELD_OWNER in acp-core
       */
      const keepHistory =
        Boolean(incoming.id) &&
        incomingEmpty &&
        (bucket.state.timeline?.length ?? 0) > 0 &&
        (bucket.state.id === incoming.id ||
          replayWindows.wasRecentlyReplayed(incoming.id) ||
          !bucket.state.id);
      // Single full-snapshot entry: ownership merge lives inside hydrate.
      // Keep eventId ring when preserving history so live updates still dedupe.
      const nextSession = hydrateSessionBucket(bucket, incoming, {
        clearDedupe: !keepHistory,
      });
      // If we had provisional empty-id bucket, re-key under real id.
      if (msg.session.id && reduceBuckets.has("__pending__")) {
        reduceBuckets.delete("__pending__");
        reduceBuckets.set(msg.session.id, bucket);
      }
      // Non-empty full hydrate ends any open replay for this session (I4-safe).
      const closedReplay = replayWindows.close(msg.session.id);
      handlers.onState(
        nextSession,
        closedReplay ? { recency: "passive" } : undefined,
      );
      return true;
    }

    if (msg.type === "replay_begin") {
      // Paint pending chunks before the window opens and the body resets.
      stream?.flushAll();
      replayWindows.arm(msg.sessionId);
      // Load replay re-applies the full transcript. Drop catalog seed body so
      // chunks are not double-appended on top of the cache (identity merge is
      // best-effort; a clean base is safer). Keep id / workspace / model.
      if (msg.sessionId) {
        const bucket = bucketFor(msg.sessionId);
        if ((bucket.state.timeline?.length ?? 0) > 0) {
          // Intentional client body reset before re-applying load replay —
          // not a bridge full-state snapshot; replace skips ownership merge
          // so empty timeline actually clears (merge would keep the old body).
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
            { clearDedupe: true, replace: true },
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
      if (replayWindows.isOpen(msg.sessionId)) {
        return true;
      }
      if (!stream) {
        notifySessionUpdate(msg.sessionId, next, msg.eventId, applied);
      } else if (needsImmediateFlush(before, next)) {
        stream.emitNow(msg.sessionId, msg.eventId);
      } else if (applied) {
        // Deduped frames changed nothing; only real changes wait for a frame.
        stream.defer(msg.sessionId, msg.eventId);
      }
      return true;
    }

    if (msg.type === "replay_end") {
      stream?.flushAll();
      const bucket = bucketFor(msg.sessionId);
      if (msg.sessionId && !bucket.state.id) {
        bucket.state = { ...bucket.state, id: msg.sessionId };
      }
      replayWindows.close(msg.sessionId);
      // Node path: already-reduced snapshot — ownership-merge so missing
      // orchestration maps (subagents/goal) do not wipe live cards.
      // Go path: ordered raw updates.
      if (msg.session) {
        hydrateSessionBucket(bucket, msg.session, { clearDedupe: true });
      } else {
        reduceReplayEndUpdates(bucket, msg.updates);
      }
      // T7: override batch-reduce streaming residue with authoritative lifecycle.
      const finalState = applyReplayEndAuthoritative(bucket, msg);
      if (msg.sessionId) {
        replayWindows.markReplayed(msg.sessionId);
      }
      handlers.onState(finalState, { recency: "passive" });
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
      // Lifecycle is always urgent (status / permission / model / mode).
      if (stream) {
        stream.emitNow(msg.sessionId, undefined);
      } else {
        notifySessionUpdate(msg.sessionId, next, undefined, true);
      }
      return true;
    }

    // Notices (errors, info, pool, …) run after every pending paint.
    stream?.flushAll();
    // Hard error: if session-scoped and replaying, flush that window (I4)
    // before the error handler runs.
    if (msg.type === "error" && msg.sessionId && replayWindows.isOpen(msg.sessionId)) {
      replayWindows.flush(msg.sessionId);
    }
    return routeBridgeNotice(handlers, msg);
  }

  return {
    handleServerMsg,
    seedSession,
    flushAllReplays: replayWindows.flushAll,
    flushPendingUpdates: () => {
      stream?.flushAll();
    },
    clearBuckets: () => {
      // Never let a later emit read a freshly emptied bucket.
      stream?.flushAll();
      reduceBuckets.clear();
      // Positions describe these buckets; they go together.
      control.clear();
    },
    pendingUpdateIds: () => stream?.pendingIds() ?? [],
    replayingSessionIds: replayWindows.openIds,
    bucketFor,
    noteOwnStart: control.noteOwnStart,
    pendingResyncs: control.pendingResyncs,
  };
}
