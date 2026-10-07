/**
 * Inbound SessionState routing: heal → provenance gate → child/pending or catalog.
 * Whitelist (I2): only local/resumed/disk enter catalog; wire stays pending.
 *
 * Steps live in sessionStoreInboundAdmission (heal, roles, isolation) and
 * sessionStoreInboundCatalog (catalog upsert); this module orders them and
 * owns the canvas-follow write. The slice types live in sessionStoreLiveSlice
 * and are re-exported here so existing imports keep working.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import { isUserFacingProvenance, stampProvenance } from "./sessionProvenance";
import { pinModeHoldOnCanvas } from "./sessionStoreModeHoldCanvas";
import {
  mergeCanvasInbound,
  resolveCanvasFollow,
} from "./sessionStoreLiveFollow";
import {
  admitInboundRoles,
  healInboundSession,
  isolateInboundSession,
} from "./sessionStoreInboundAdmission";
import { upsertInboundCatalog } from "./sessionStoreInboundCatalog";
import { admitForceNewSessionFromInfo as admitForceNewSessionFromInfoImpl } from "./sessionStoreForceNew";
import { noteInboundStatus, type InboundOutcome } from "./sessionTurnEdge";
import type { GetState, SetState } from "./sessionStoreLiveSlice";

export { promotePendingToCatalog } from "./sessionStorePending";
export { shouldStampLocalFromForceNewInfo } from "./sessionProvenance";
export type { InboundOutcome } from "./sessionTurnEdge";
export type {
  GetState,
  LiveStoreSlice,
  SetState,
} from "./sessionStoreLiveSlice";

export { healSessionTimeline } from "./sessionStoreSupport";

/**
 * Stamp `local` from forceNew ready-info; re-admits pending if needed.
 * @param set Zustand set. @param get Zustand get.
 * @param sessionId Info session id. @param message Ready-contract text.
 * @returns True when local was stamped for this id.
 */
export function admitForceNewSessionFromInfo(
  set: SetState,
  get: GetState,
  sessionId: string | undefined | null,
  message: string | undefined | null,
): boolean {
  return admitForceNewSessionFromInfoImpl(
    set as never,
    get as never,
    sessionId,
    message,
    applyInboundSession as never,
  );
}

/**
 * Route one inbound SessionState (hydrate or post-reduce relay) into catalog + canvas.
 * Shared by full `state` and client-reduced `session_update` so both paths stay identical.
 *
 * Admission (I2): provenance must be user-facing (local/resumed/disk) before
 * catalog upsert. Known children buffer in childSessions; unproven wire ids
 * buffer in pendingSessions. Viewing a child still uses the canvas path.
 * forceNew `local` is stamped from bridge info (session ready), not empty state.
 *
 * Does not drain the prompt queue or fire occupancy RPC — those are live
 * apply-site reactions to {@link InboundOutcome.turnSettled} / follow.
 *
 * @param set Zustand set.
 * @param get Zustand get.
 * @param session SessionState after heal-ready reduce / hydrate.
 * @param opts `recency: "passive"` keeps catalog recency (select / load)
 *   and never reports `turnSettled`.
 * @returns Frame facts for the live apply site (hydrate callers ignore them).
 */
export function applyInboundSession(
  set: SetState,
  get: GetState,
  session: SessionState,
  opts?: { recency?: "live" | "passive" },
): InboundOutcome {
  /** Healed snapshot (prefs workspace + preserved local media). */
  const healed = healInboundSession(session, get().session);
  /** Roles / provenance / pending / child buffers after spawn claims. */
  const admission = admitInboundRoles(get(), healed);
  const viewing = get().viewingSessionId;
  const isKnownChild = Boolean(admission.roles[healed.id]);
  const viewingThisChild = viewing !== null && viewing === healed.id;
  const userFacing = isUserFacingProvenance(admission.provenance[healed.id]);

  // Unproven wire id (and known children not being viewed): isolate — no catalog.
  if (!userFacing && !viewingThisChild) {
    return isolateInboundSession(set, get, healed, admission, isKnownChild);
  }

  // User-facing (or viewed child): catalog path.
  const { roles, pending, pendingOrder, childSessions } = admission;
  const prevCatalog = get().catalog;
  const { catalog, provenance } = upsertInboundCatalog({
    prevCatalog,
    healed,
    roles,
    childSessions,
    // Ensure child role still stamps when viewing a child mid-stream.
    provenance: isKnownChild
      ? stampProvenance(admission.provenance, healed.id, "child")
      : admission.provenance,
    recency: opts?.recency,
  });

  /** Last canvas-owned live id, used only before an explicit selection exists. */
  const active = get().activeSessionId;
  /** Whether this inbound snapshot may update canvas-scoped state. */
  const follow = resolveCanvasFollow({
    viewing,
    active,
    localDraft: Boolean(get().localDraft),
    creatingSession: Boolean(get().creatingSession),
    inbound: healed,
  });
  // Only a canvas-owned snapshot may promote activeSessionId. Keeping
  // background ids out prevents alternating streams from taking turns
  // satisfying the active fallback and repainting the selected chat.
  const nextActive = follow && healed.id ? healed.id : active;
  // Go empty hydrate / short partial reduce must not blank a catalog-seeded
  // canvas; forceNew still keeps optimistic local user bubbles only.
  // pinModeHoldOnCanvas keeps the chip and Working strip during set_mode.
  const canvasSession = follow
    ? pinModeHoldOnCanvas(mergeCanvasInbound(healed, get().session, catalog), get().pendingMode, get().heldPrompt)
    : healed;
  // Replay landed: the first snapshot for this id that carries content
  // is the single post-load flush. A session that really is empty keeps
  // the hint until the user's first prompt fills the canvas — harmless,
  // and it never hides content that exists.
  // Capture before set(): restoreDone clears restoringSessionId.
  const stillRestoring = get().restoringSessionId === healed.id;
  const restoreDone = stillRestoring && healed.timeline.length > 0;
  const catalogChanged = catalog !== prevCatalog;
  set({
    ...(catalogChanged
      ? {
          catalog,
          catalogRevision: (get().catalogRevision ?? 0) + 1,
        }
      : {}),
    sessionRoles: roles,
    sessionProvenance: provenance,
    childSessions,
    pendingSessions: pending,
    pendingSessionOrder: pendingOrder,
    activeSessionId: nextActive,
    connectionMode: "live-bridge",
    lastError: null,
    ...(restoreDone ? { restoringSessionId: null } : {}),
    ...(follow
      ? {
          session: canvasSession,
          viewingSessionId: healed.id || viewing,
          // Handshake painted the forceNew session — leave draft mode.
          ...(get().creatingSession && healed.id
            ? { creatingSession: false, localDraft: false }
            : {}),
        }
      : {}),
  });
  const passive = opts?.recency === "passive";
  const turnSettled =
    !passive &&
    follow &&
    !stillRestoring &&
    noteInboundStatus(healed.id, healed.status);
  return {
    sessionId: healed.id,
    follow,
    restoreDone,
    turnSettled,
  };
}
