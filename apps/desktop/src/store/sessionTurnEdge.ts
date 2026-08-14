/**
 * Per-session busy→idle edge memory for inbound frames.
 * Inbound apply records the edge; live apply is the only place that drains
 * the queue or backfills occupancy from a settle.
 */

/** Facts recorded after one inbound frame. Side effects stay at the live site. */
export type InboundOutcome = {
  /** Healed session id for this frame (may be empty). */
  sessionId: string;
  /** True when this frame updated the painted canvas. */
  follow: boolean;
  /** True when this frame cleared `restoringSessionId` for this id. */
  restoreDone: boolean;
  /**
   * True when this frame is a real busy→idle settle on the followed canvas.
   * Passive hydrate, first-seen status, and still-restoring ids are false.
   */
  turnSettled: boolean;
};

/**
 * Outcome for isolated / pending frames that must not drain or backfill.
 * @param sessionId Healed id (may be empty).
 */
export function isolatedInboundOutcome(sessionId: string): InboundOutcome {
  return {
    sessionId,
    follow: false,
    restoreDone: false,
    turnSettled: false,
  };
}

/** Last observed inbound status per session id. */
const lastStatus = new Map<string, string>();

/**
 * True when the session cannot accept a new turn (streaming or permission).
 * @param status Live / inbound session status string.
 */
export function isBusyStatus(status: string): boolean {
  return status === "streaming" || status === "waiting_permission";
}

/**
 * Record one inbound status frame and report a real busy→idle settle.
 * First observation for an id is never a settle (open / restore is not a turn).
 * @param sessionId Frame session id; empty always returns false and stores nothing.
 * @param status Frame status.
 * @returns True only when the previous frame was busy and this frame is idle.
 */
export function noteInboundStatus(sessionId: string, status: string): boolean {
  if (!sessionId) {
    return false;
  }
  const prev = lastStatus.get(sessionId);
  lastStatus.set(sessionId, status);
  return status === "idle" && prev !== undefined && isBusyStatus(prev);
}

/**
 * Drop edge memory for one session (delete / close that id).
 * A later idle restore of the same id must not look like a settle.
 * @param sessionId Session to forget; empty is a no-op.
 */
export function forgetTurnEdge(sessionId: string): void {
  if (sessionId) {
    lastStatus.delete(sessionId);
  }
}

/**
 * Drop every session's edge memory (live disconnect / bridge close).
 * After reconnect, the first idle snapshot is not a settle.
 */
export function forgetAllTurnEdges(): void {
  lastStatus.clear();
}
