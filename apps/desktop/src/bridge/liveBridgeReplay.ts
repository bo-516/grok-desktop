/**
 * Load-replay support for the bridge dispatcher: per-session replay window
 * bookkeeping (I3 isolation, I4 timeout) plus the pure replay_end reducers.
 * Owns timers only — painting a flushed window is delegated back to the
 * dispatcher through `onFlush`, so this module never touches the store.
 */

import type { SessionState, SessionUpdate } from "@grok-desktop/acp-core";
import {
  applySessionLifecycle,
  reduceSessionUpdate,
  replayEndCanvasStatus,
  type SessionReduceBucket,
} from "../lib/sessionReduce";
import type { BridgeServerMsg } from "./liveBridgeTypes";

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

/** Options for createReplayWindowTracker. */
export type ReplayWindowTrackerOpts = {
  /** Optional fake clock; defaults to global timers. */
  clock?: ReplayDispatchClock;
  /** Silence timeout before a window force-flushes (I4). */
  timeoutMs: number;
  /**
   * Paint one session after its window closed through flush (timeout,
   * error, socket close). Not called by `close`, whose caller paints itself.
   * @param sessionId Session whose window just closed.
   */
  onFlush: (sessionId: string) => void;
};

/** Replay window state owned by one bridge connection. */
export type ReplayWindowTracker = {
  /**
   * Open (or re-arm) the window for a session and its I4 timeout.
   * @param sessionId Session entering load replay.
   */
  arm: (sessionId: string) => void;
  /**
   * Whether the session is inside a silent replay window.
   * @param sessionId Session id ("" is never open unless armed with "").
   */
  isOpen: (sessionId: string) => boolean;
  /**
   * Close a window without painting (caller paints).
   * @param sessionId Session to close.
   * @returns True when a window was open; false is a no-op.
   */
  close: (sessionId: string) => boolean;
  /**
   * Close a window and paint it via `onFlush`; no-op when not open.
   * @param sessionId Session to flush.
   */
  flush: (sessionId: string) => void;
  /** Flush every open window (socket close / hard error). */
  flushAll: () => void;
  /** Session ids currently inside a window (test/observe). */
  openIds: () => string[];
  /**
   * Remember that a load-replay batch just finished for this session; the
   * mark drops itself after a quiet window.
   * @param sessionId Non-empty session id from replay_end.
   */
  markReplayed: (sessionId: string) => void;
  /**
   * Whether the session finished a replay batch recently.
   * @param sessionId Session id from an inbound `state` frame.
   */
  wasRecentlyReplayed: (sessionId: string) => boolean;
};

/**
 * Create replay window bookkeeping for one bridge connection.
 * @param opts Clock, timeout and the paint callback for flushed windows.
 * @returns Tracker whose state lives only in this closure.
 */
export function createReplayWindowTracker(
  opts: ReplayWindowTrackerOpts,
): ReplayWindowTracker {
  const clock = opts.clock ?? defaultClock;
  /** Sessions currently inside a silent replay window (I3 isolation). */
  const replayingSessions = new Map<string, ReplayWindow>();
  /**
   * Sessions that recently finished a load-replay batch. Go bridge still emits
   * a post-handshake `state` with an empty timeline (it never holds one); that
   * must not wipe the client-reduced history from replay_end.
   */
  const recentlyReplayed = new Set<string>();

  /**
   * Close one session's window (timer + map entry) without painting.
   * @param sessionId Session to close.
   * @returns True when a window was open.
   */
  function close(sessionId: string): boolean {
    const win = replayingSessions.get(sessionId);
    if (!win) {
      return false;
    }
    clock.clearTimeout(win.timer);
    replayingSessions.delete(sessionId);
    return true;
  }

  /**
   * Close one session's replay window and notify the store with current bucket state.
   * @param sessionId Session to flush.
   */
  function flush(sessionId: string): void {
    if (!close(sessionId)) {
      return;
    }
    opts.onFlush(sessionId);
  }

  /**
   * Arm or replace the I4 timeout for a session's replay window.
   * @param sessionId Session whose window must eventually close.
   */
  function arm(sessionId: string): void {
    const prev = replayingSessions.get(sessionId);
    if (prev) {
      clock.clearTimeout(prev.timer);
    }
    const timer = clock.setTimeout(() => {
      // Bridge never closed the window — force one paint so the session is not mute.
      flush(sessionId);
    }, opts.timeoutMs);
    replayingSessions.set(sessionId, { timer });
  }

  /**
   * Close every open replay window (socket close / hard error).
   */
  function flushAll(): void {
    const ids = [...replayingSessions.keys()];
    for (const id of ids) {
      flush(id);
    }
  }

  /**
   * Mark a finished replay and schedule the mark's removal.
   * @param sessionId Session that just received replay_end.
   */
  function markReplayed(sessionId: string): void {
    recentlyReplayed.add(sessionId);
    // Drop the mark after a quiet window so a later true empty session can hydrate.
    clock.setTimeout(() => {
      recentlyReplayed.delete(sessionId);
    }, 5_000);
  }

  return {
    arm,
    isOpen: (sessionId) => replayingSessions.has(sessionId),
    close,
    flush,
    flushAll,
    openIds: () => [...replayingSessions.keys()],
    markReplayed,
    wasRecentlyReplayed: (sessionId) => recentlyReplayed.has(sessionId),
  };
}

/**
 * Apply authoritative lifecycle fields from replay_end (T7).
 * @param bucket Target reduce bucket.
 * @param msg replay_end payload.
 * @returns Bucket state after overriding batch-reduce streaming residue.
 */
export function applyReplayEndAuthoritative(
  bucket: SessionReduceBucket,
  msg: Extract<BridgeServerMsg, { type: "replay_end" }>,
): SessionState {
  return applySessionLifecycle(bucket, {
    status: replayEndCanvasStatus(msg.status),
    model: msg.model,
    mode: msg.mode,
  });
}

/**
 * Go path of replay_end: reduce the ordered raw updates into the bucket.
 * Tolerates both `{ update, eventId }` wire items and bare SessionUpdate;
 * items without a `sessionUpdate` discriminant are skipped.
 * @param bucket Target reduce bucket (mutated through reduceSessionUpdate).
 * @param updates `msg.updates` from replay_end; undefined reduces nothing.
 */
export function reduceReplayEndUpdates(
  bucket: SessionReduceBucket,
  updates: Extract<BridgeServerMsg, { type: "replay_end" }>["updates"],
): void {
  for (const item of updates ?? []) {
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
