/**
 * Bridge-asserted session provenance on the inbound path.
 *
 * The bridge stamps `provenance` on hydrate frames (state / replay_* / ready
 * info) and on live frames of subagent children. This module reads it,
 * resolves `own` (the startId matches a `start` sent on this connection) and
 * tells the store once per change, before the frame itself is painted — so
 * admission routes the frame by fact instead of by heuristic.
 */

import type { BridgeServerMsg, LiveBridgeHandlers } from "./liveBridgeTypes";
import type {
  BridgeProvenance,
  BridgeSessionProvenance,
} from "./liveBridgeStreamTypes";

/** Own start ids remembered per connection (a burst of New chats at most). */
export const OWN_START_IDS_MAX = 32;

/** Per-connection provenance relay. */
export type ProvenanceRelay = {
  /**
   * Remember a startId this connection sent with `start`.
   * @param startId Client-generated id; empty ids are ignored.
   */
  noteOwnStart: (startId: string) => void;
  /**
   * Read the frame's provenance and notify the store when it changed.
   * @param msg Any inbound frame (frames without provenance are ignored).
   * @returns The frame's provenance with `own` resolved, or null.
   */
  note: (msg: BridgeServerMsg) => BridgeSessionProvenance | null;
  /** Forget own start ids and change history (socket close). */
  clear: () => void;
};

/**
 * Session id a provenance-carrying frame describes.
 * @param msg Inbound frame.
 * @returns `sessionId`, else `session.id` for state frames, else "".
 */
export function provenanceSessionId(msg: BridgeServerMsg): string {
  if ("sessionId" in msg && typeof msg.sessionId === "string") {
    return msg.sessionId;
  }
  if (msg.type === "state") {
    return msg.session.id ?? "";
  }
  return "";
}

/**
 * Read a well-formed provenance object off a frame.
 * @param msg Inbound frame.
 * @returns The wire provenance, or null when absent / malformed.
 */
export function readProvenance(msg: BridgeServerMsg): BridgeProvenance | null {
  const raw = "provenance" in msg ? msg.provenance : undefined;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (raw.kind !== "started" && raw.kind !== "resumed" && raw.kind !== "child") {
    return null;
  }
  return raw;
}

/**
 * Change-detection key for one session's provenance.
 * @param p Resolved provenance.
 * @returns String equal for equal (kind, parent, startId, own).
 */
function provenanceKey(p: BridgeSessionProvenance): string {
  return [p.kind, p.parentSessionId ?? "", p.startId ?? "", p.own].join("|");
}

/**
 * Create the per-connection relay.
 * @param handlers Connection handlers; `onProvenance` may be omitted.
 * @returns Relay used by the dispatcher.
 */
export function createProvenanceRelay(
  handlers: Pick<LiveBridgeHandlers, "onProvenance">,
): ProvenanceRelay {
  /** startIds this connection sent, oldest first. */
  const ownStarts: string[] = [];
  /** Last notified key per session. */
  const lastKey = new Map<string, string>();

  return {
    noteOwnStart: (startId) => {
      if (!startId || ownStarts.includes(startId)) {
        return;
      }
      ownStarts.push(startId);
      if (ownStarts.length > OWN_START_IDS_MAX) {
        ownStarts.shift();
      }
    },
    note: (msg) => {
      const wire = readProvenance(msg);
      const sessionId = provenanceSessionId(msg);
      if (!wire || !sessionId) {
        return null;
      }
      const resolved: BridgeSessionProvenance = {
        ...wire,
        own: Boolean(wire.startId) && ownStarts.includes(wire.startId ?? ""),
      };
      const key = provenanceKey(resolved);
      if (lastKey.get(sessionId) !== key) {
        lastKey.set(sessionId, key);
        handlers.onProvenance?.(sessionId, resolved);
      }
      return resolved;
    },
    clear: () => {
      ownStarts.length = 0;
      lastKey.clear();
    },
  };
}
