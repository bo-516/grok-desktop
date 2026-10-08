/**
 * Wire types for the bridge-owned session stream (Go `internal/sessionstream`).
 *
 * Every per-session frame the bridge relays (session_update,
 * session_lifecycle, state, replay_begin, replay_end) carries a position:
 * `epoch` names the frame source (one agent runtime; a respawn / reload is a
 * new epoch whose seq restarts at 1) and `seq` counts frames per
 * (session, epoch). Point-to-point `state` snapshots carry `headSeq` instead.
 * Frames without these fields (older fixtures, notices) bypass sequencing.
 */

/** How the bridge says a session id entered it (first-hand, not guessed). */
export type BridgeProvenanceKind = "started" | "resumed" | "child";

/** `provenance` field on hydrate frames and on child live frames. */
export type BridgeProvenance = {
  /**
   * started = session/new for a client start; resumed = session/load;
   * child = announced by its parent's subagent_spawned / _finished update.
   */
  kind: BridgeProvenanceKind;
  /** Parent chat for subagent children (lineage is kept if a child is resumed). */
  parentSessionId?: string;
  /** Echo of the `start` request id that created the session (started only). */
  startId?: string;
};

/**
 * Provenance as handed to the store: the wire fields plus whether this
 * window's own `start` request created the session (startId match).
 */
export type BridgeSessionProvenance = BridgeProvenance & {
  /** True only when `startId` matches a start sent on this connection. */
  own: boolean;
};

/** Optional stream fields shared by every per-session frame. */
export type BridgeFrameMeta = {
  /** Frame source (agent runtime) id; opaque, compared for equality only. */
  epoch?: string;
  /** Position of this frame in its (session, epoch) stream, from 1. */
  seq?: number;
  /** Snapshot frames only: last seq the snapshot reflects. */
  headSeq?: number;
  /** Bridge-asserted provenance (hydrate frames, child live frames, info). */
  provenance?: BridgeProvenance;
};

/** Outcome of a `resync` request. */
export type BridgeResyncStatus = "ok" | "too_old" | "epoch_mismatch";

/** `resync_result` frame (answer to `{type:"resync", sessionId, epoch, fromSeq}`). */
export type BridgeResyncResultMsg = {
  type: "resync_result";
  sessionId: string;
  status: BridgeResyncStatus;
  /** Echo of the requested epoch. */
  epoch: string;
  /** Echo of the requested position. */
  fromSeq: number;
  /** Requested stream's head (0 on epoch_mismatch). */
  headSeq: number;
  /** Session's current stream when it differs or the request missed. */
  latestEpoch?: string;
  latestHeadSeq?: number;
  /** status ok: the frames after fromSeq, exactly as first sent. */
  frames?: unknown[];
};

/** Why a stream position was abandoned in favour of a full hydrate. */
export type StreamResetReason = "too_old" | "epoch_mismatch" | "timeout";
