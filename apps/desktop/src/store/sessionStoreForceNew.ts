/**
 * forceNew local admission: stamp only from bridge ready-info contract.
 * Empty inbound state frames never stamp local (wire children share that shape).
 * Bare sessionId on recovery/ops info never stamps local either.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  shouldStampLocalFromForceNewInfo,
  stampProvenance,
  takePendingSession,
  type SessionProvenanceIndex,
} from "./sessionProvenance";

/** Minimal get shape for forceNew admit (avoids import cycle with inbound). */
type ForceNewGet = () => {
  creatingSession?: boolean;
  localDraft?: boolean;
  sessionProvenance?: SessionProvenanceIndex;
  pendingSessions?: Record<string, SessionState>;
  pendingSessionOrder?: string[];
};

/** Minimal set shape for forceNew admit. */
type ForceNewSet = (
  partial:
    | Record<string, unknown>
    | ((state: Record<string, unknown>) => Record<string, unknown>),
) => void;

/**
 * Stamp `local` from a forceNew bridge ready-info frame and re-admit any
 * pending buffer for that id (info may race ahead of or behind the first state).
 * Requires message text matching `session <id> ready` (Node/Go handshake).
 *
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Session id from info.sessionId (Node/Go handshake).
 * @param message Info message text (must be ready contract).
 * @param reapplyInbound Re-run admission for a previously buffered state frame.
 * @returns True when local was stamped for this id.
 */
export function admitForceNewSessionFromInfo(
  set: ForceNewSet,
  get: ForceNewGet,
  sessionId: string | undefined | null,
  message: string | undefined | null,
  reapplyInbound: (
    set: ForceNewSet,
    get: ForceNewGet,
    session: SessionState,
  ) => void,
): boolean {
  if (
    !shouldStampLocalFromForceNewInfo({
      creatingSession: Boolean(get().creatingSession),
      localDraft: Boolean(get().localDraft),
      sessionId,
      message,
    })
  ) {
    return false;
  }
  const id = (sessionId ?? "").trim();
  if (!id) {
    return false;
  }
  const provenance = stampProvenance(
    get().sessionProvenance ?? {},
    id,
    "local",
  );
  const taken = takePendingSession(
    get().pendingSessions ?? {},
    get().pendingSessionOrder ?? [],
    id,
  );
  set({
    sessionProvenance: provenance,
    pendingSessions: taken.pending,
    pendingSessionOrder: taken.order,
  });
  // If a state frame was buffered as wire before info, re-run admission now.
  if (taken.taken) {
    reapplyInbound(set, get, taken.taken);
  }
  return true;
}
