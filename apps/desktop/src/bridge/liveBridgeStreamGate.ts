/**
 * Stateful sequence gate for the bridge dispatcher.
 *
 * Sits in front of every branch of handleServerMsg (the seam PR #12 left in
 * liveBridgeDispatch): stamped frames pass only when they are next in their
 * (session, epoch) stream. A gap flushes coalesced notifies, drops the frame
 * and sends `resync`; the answer's frames re-enter the dispatcher (and this
 * gate) in order. `too_old`, `epoch_mismatch` or no answer within
 * {@link RESYNC_TIMEOUT_MS} fall back to `get_state` and re-anchor on the
 * next frame. Unstamped frames always pass (backward compatible).
 */

import type { ReplayDispatchClock } from "./liveBridgeReplay";
import {
  ADOPT_NEXT,
  classifyFrame,
  recordPosition,
  shouldAdoptSnapshot,
  streamKey,
} from "./liveBridgeStreamSeq";
import type {
  BridgeResyncResultMsg,
  StreamResetReason,
} from "./liveBridgeStreamTypes";
import type { BridgeServerMsg } from "./liveBridgeTypes";

/** How long a resync may stay unanswered before the get_state fallback (ms). */
export const RESYNC_TIMEOUT_MS = 10_000;

/** Options for createStreamGate. */
export type StreamGateOpts = {
  /** Timer source (fake clock in tests); defaults to global timers. */
  clock?: ReplayDispatchClock;
  /**
   * Send one request to the bridge. Omitted (tests without a socket) → gaps
   * and fallbacks only re-anchor locally.
   * @returns False when the socket is not open.
   */
  send?: (msg: Record<string, unknown>) => boolean;
  /** Runs right before a resync request (dispatcher drains the coalescer). */
  beforeResync: () => void;
  /**
   * Feed one frame from a resync answer back through the dispatcher.
   * @param frame A frame exactly as the bridge first sent it.
   */
  replay: (frame: BridgeServerMsg) => void;
  /** Informational: a stream fell back to the full hydrate path. */
  onReset?: (sessionId: string, reason: StreamResetReason) => void;
  /** Override {@link RESYNC_TIMEOUT_MS}. */
  resyncTimeoutMs?: number;
};

/** Per-connection sequence gate. */
export type StreamGate = {
  /**
   * Decide whether the dispatcher should process a frame.
   * @param msg Any inbound frame.
   * @returns True to process it; false when it was a duplicate or a gap.
   */
  admit: (msg: BridgeServerMsg) => boolean;
  /**
   * Apply a `resync_result`: replay its frames or fall back.
   * @param msg Bridge answer; stale answers (nothing pending) are ignored.
   */
  handleResyncResult: (msg: BridgeResyncResultMsg) => void;
  /** Drop every position and pending resync (socket close). */
  clear: () => void;
  /** Test/observe: last applied seq of (session, epoch). */
  position: (sessionId: string, epoch: string) => number | undefined;
  /** Test/observe: stream keys with a resync in flight. */
  pendingResyncs: () => string[];
};

/** Production timers. */
const defaultClock: ReplayDispatchClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

/** Stream position fields read off a frame, when it carries them. */
type FrameStamp = {
  sessionId: string;
  epoch: string;
  seq?: number;
  headSeq?: number;
};

/**
 * Extract (session, epoch, seq | headSeq) from a frame.
 * @param msg Inbound frame.
 * @returns Stamp, or null for unstamped frames (always admitted).
 */
export function readFrameStamp(msg: BridgeServerMsg): FrameStamp | null {
  // resync_result names an epoch too, but it is a control frame, not a position.
  if (msg.type === "resync_result" || !("epoch" in msg)) {
    return null;
  }
  if (typeof msg.epoch !== "string" || !msg.epoch) {
    return null;
  }
  const sessionId =
    msg.type === "state" ? (msg.session.id ?? "") : (msg.sessionId ?? "");
  if (!sessionId) {
    return null;
  }
  const seq = typeof msg.seq === "number" ? msg.seq : undefined;
  const headSeq = typeof msg.headSeq === "number" ? msg.headSeq : undefined;
  if (seq === undefined && headSeq === undefined) {
    return null;
  }
  return { sessionId, epoch: msg.epoch, seq, headSeq };
}

/**
 * Create the gate for one bridge connection.
 * @param opts Clock, request sender, coalescer drain, replay sink, reset hook.
 * @returns Gate used by createLiveBridgeDispatch.
 */
export function createStreamGate(opts: StreamGateOpts): StreamGate {
  const clock = opts.clock ?? defaultClock;
  const timeoutMs = opts.resyncTimeoutMs ?? RESYNC_TIMEOUT_MS;
  /** sessionId → (epoch → last applied seq). */
  const positions = new Map<string, Map<string, number>>();
  /** streamKey → timeout of the resync in flight. */
  const inflight = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Current position of one stream.
   * @param sessionId Session id. @param epoch Epoch id.
   */
  function position(sessionId: string, epoch: string): number | undefined {
    return positions.get(sessionId)?.get(epoch);
  }

  /**
   * Abandon a stream position: re-anchor on its next frame, ask the bridge
   * for an authoritative snapshot and tell the store why.
   * @param sessionId Session id. @param epoch Abandoned epoch.
   * @param reason Why the resync could not be served.
   */
  function fallBack(
    sessionId: string,
    epoch: string,
    reason: StreamResetReason,
  ): void {
    recordPosition(positions, sessionId, epoch, ADOPT_NEXT);
    opts.send?.({ type: "get_state", sessionId });
    opts.onReset?.(sessionId, reason);
  }

  /**
   * Ask the bridge for every frame after fromSeq (one request per stream).
   * @param stamp Frame that revealed the gap. @param fromSeq Last applied seq.
   */
  function requestResync(stamp: FrameStamp, fromSeq: number): void {
    const key = streamKey(stamp.sessionId, stamp.epoch);
    // Paint what we have before frames are replayed on top of it.
    opts.beforeResync();
    if (position(stamp.sessionId, stamp.epoch) === undefined) {
      recordPosition(positions, stamp.sessionId, stamp.epoch, fromSeq);
    }
    const sent =
      opts.send?.({
        type: "resync",
        sessionId: stamp.sessionId,
        epoch: stamp.epoch,
        fromSeq,
      }) ?? false;
    if (!sent) {
      // No socket: nothing can answer. Re-anchor so the stream keeps flowing.
      recordPosition(positions, stamp.sessionId, stamp.epoch, ADOPT_NEXT);
      return;
    }
    inflight.set(
      key,
      clock.setTimeout(() => {
        inflight.delete(key);
        fallBack(stamp.sessionId, stamp.epoch, "timeout");
      }, timeoutMs),
    );
  }

  /**
   * Gate one frame (see {@link StreamGate.admit}).
   * @param msg Inbound frame.
   */
  function admit(msg: BridgeServerMsg): boolean {
    const stamp = readFrameStamp(msg);
    if (!stamp) {
      return true;
    }
    const key = streamKey(stamp.sessionId, stamp.epoch);
    const last = position(stamp.sessionId, stamp.epoch);
    if (stamp.seq === undefined) {
      // Snapshot (get_state / connect): anchors unknown or abandoned streams.
      if (stamp.headSeq !== undefined && shouldAdoptSnapshot(last, inflight.has(key))) {
        recordPosition(positions, stamp.sessionId, stamp.epoch, stamp.headSeq);
      }
      return true;
    }
    const verdict = classifyFrame({
      last,
      sessionKnown: (positions.get(stamp.sessionId)?.size ?? 0) > 0,
      inflight: inflight.has(key),
      seq: stamp.seq,
    });
    if (verdict.action === "apply") {
      recordPosition(positions, stamp.sessionId, stamp.epoch, stamp.seq);
      return true;
    }
    if (verdict.action === "resync") {
      requestResync(stamp, verdict.fromSeq);
    }
    return false;
  }

  /**
   * Apply one resync answer (see {@link StreamGate.handleResyncResult}).
   * @param msg Bridge answer.
   */
  function handleResyncResult(msg: BridgeResyncResultMsg): void {
    const key = streamKey(msg.sessionId, msg.epoch);
    const timer = inflight.get(key);
    if (timer === undefined) {
      return;
    }
    clock.clearTimeout(timer);
    inflight.delete(key);
    if (msg.status !== "ok") {
      fallBack(msg.sessionId, msg.epoch, msg.status);
      return;
    }
    // Frames re-enter the dispatcher: duplicates drop, the rest apply in order.
    for (const frame of msg.frames ?? []) {
      if (frame && typeof frame === "object") {
        opts.replay(frame as BridgeServerMsg);
      }
    }
  }

  return {
    admit,
    handleResyncResult,
    clear: () => {
      for (const timer of inflight.values()) {
        clock.clearTimeout(timer);
      }
      inflight.clear();
      positions.clear();
    },
    position,
    pendingResyncs: () => [...inflight.keys()],
  };
}
