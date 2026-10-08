/**
 * Pure sequencing rules for bridge session streams (see liveBridgeStreamTypes).
 *
 * The client keeps, per session, the last applied seq of every epoch it has
 * seen. A frame is applied when it is the next one, dropped when it is a
 * duplicate (or arrives while its gap is being resynced), and a gap asks the
 * bridge for the missing frames. All functions here are pure; the stateful
 * gate (timers, requests) lives in liveBridgeStreamGate.
 */

/** Position marker meaning "adopt whatever this epoch sends next". */
export const ADOPT_NEXT = -1;

/** Epochs remembered per session (dual sources + a few respawns). */
export const MAX_EPOCHS_PER_SESSION = 8;

/** What to do with one stamped frame. */
export type StreamVerdict =
  /** In order (or first contact): reduce it and record its seq. */
  | { action: "apply" }
  /** Already applied, or covered by a pending resync: ignore it. */
  | { action: "drop"; reason: "duplicate" | "awaiting-resync" }
  /** Frames are missing: drop this one and request everything after fromSeq. */
  | { action: "resync"; fromSeq: number };

/** Inputs for {@link classifyFrame}. */
export type FrameFacts = {
  /** Last applied seq for (session, epoch); undefined when never seen. */
  last: number | undefined;
  /** Whether the session has a recorded position under any epoch. */
  sessionKnown: boolean;
  /** Whether a resync for (session, epoch) is already in flight. */
  inflight: boolean;
  /** The frame's seq (>= 1). */
  seq: number;
};

/**
 * Decide how to handle one stamped frame.
 *
 * - First contact with a session (late joiner, fresh connection) or the first
 *   frame of a new epoch (seq 1) is adopted as the baseline.
 * - A new epoch of a known session that starts mid-way means its beginning
 *   (often the session/load replay) was missed: resync it from 0.
 * - `ADOPT_NEXT` (set after a fallback) adopts unconditionally.
 *
 * @param facts Current position, session knowledge, in-flight flag and seq.
 * @returns apply / drop / resync verdict; never throws.
 */
export function classifyFrame(facts: FrameFacts): StreamVerdict {
  const { last, sessionKnown, inflight, seq } = facts;
  if (last === ADOPT_NEXT) {
    return { action: "apply" };
  }
  if (last === undefined) {
    if (!sessionKnown || seq === 1) {
      return { action: "apply" };
    }
    return inflight
      ? { action: "drop", reason: "awaiting-resync" }
      : { action: "resync", fromSeq: 0 };
  }
  if (seq <= last) {
    return { action: "drop", reason: "duplicate" };
  }
  if (seq === last + 1) {
    return { action: "apply" };
  }
  return inflight
    ? { action: "drop", reason: "awaiting-resync" }
    : { action: "resync", fromSeq: last };
}

/**
 * Whether a snapshot (`state` with headSeq) should become the baseline.
 * Snapshots only anchor positions the client does not have (or abandoned);
 * once live frames flow they are authoritative and snapshots never rewind.
 * @param last Current position for (session, epoch), if any.
 * @param inflight Whether a resync for that stream is pending.
 * @returns True when the caller should record headSeq as the position.
 */
export function shouldAdoptSnapshot(
  last: number | undefined,
  inflight: boolean,
): boolean {
  if (inflight) {
    return false;
  }
  return last === undefined || last === ADOPT_NEXT;
}

/**
 * Record `seq` as the position of (sessionId, epoch), evicting the oldest
 * epoch of that session beyond {@link MAX_EPOCHS_PER_SESSION}.
 * Mutates `positions` (the gate's private map) and returns it.
 * @param positions sessionId → (epoch → last applied seq).
 * @param sessionId Session the frame belongs to.
 * @param epoch Frame source id.
 * @param seq Position to record (or ADOPT_NEXT).
 * @returns The same map, for chaining in tests.
 */
export function recordPosition(
  positions: Map<string, Map<string, number>>,
  sessionId: string,
  epoch: string,
  seq: number,
): Map<string, Map<string, number>> {
  let epochs = positions.get(sessionId);
  if (!epochs) {
    epochs = new Map();
    positions.set(sessionId, epochs);
  }
  epochs.set(epoch, seq);
  while (epochs.size > MAX_EPOCHS_PER_SESSION) {
    const oldest = epochs.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    epochs.delete(oldest);
  }
  return positions;
}

/**
 * Stable map key for one (session, epoch) stream.
 * @param sessionId Session id.
 * @param epoch Epoch id.
 * @returns Key unique per pair (NUL never appears in either id).
 */
export function streamKey(sessionId: string, epoch: string): string {
  return `${sessionId}\u0000${epoch}`;
}
