/**
 * Live inbound apply site: route the frame, then react to the outcome.
 * Disk hydrate calls applyInboundSession directly and must not use this hook.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  applyInboundSession,
  type GetState,
  type SetState,
} from "./sessionStoreLiveInbound";
import type { InboundOutcome } from "./sessionTurnEdge";
import { drainQueueForSettledTurn } from "./sessionStoreQueue";
import { syncTokenUsageBackfillFromInbound } from "./sessionStoreTokenUsage";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/**
 * Apply one live `onState` / `onSessionUpdate` frame and run settle hooks.
 * Drain and occupancy backfill live here so restore / replay_end cannot
 * fire them. `set`/`get` are the live slice; queue/usage actions use the
 * store contract (same object, wider type).
 * @param set Zustand set from startLiveBridgeSession.
 * @param get Zustand get from startLiveBridgeSession.
 * @param session Reduced / hydrated SessionState.
 * @param opts Recency from the live dispatcher (`passive` never settles).
 * @returns The inbound outcome (tests assert turnSettled / follow).
 */
export function applyLiveInboundSession(
  set: SetState,
  get: GetState,
  session: SessionState,
  opts?: { recency?: "live" | "passive" },
): InboundOutcome {
  const outcome = applyInboundSession(set, get, session, opts);
  if (outcome.turnSettled) {
    drainQueueForSettledTurn(
      set as SessionStoreSet,
      get as SessionStoreGet,
      outcome.sessionId,
    );
  }
  syncTokenUsageBackfillFromInbound(
    set as SessionStoreSet,
    get as SessionStoreGet,
    {
      sessionId: outcome.sessionId,
      status: session.status,
      follow: outcome.follow,
      restoreDone: outcome.restoreDone,
      tokenUsage: outcome.follow
        ? get().session.tokenUsage
        : session.tokenUsage,
    },
  );
  return outcome;
}
