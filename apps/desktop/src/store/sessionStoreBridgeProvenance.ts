/**
 * Store side of bridge-asserted provenance (phase 1 of "bridge as source of
 * truth"). Called by the dispatcher before the frame that carried the
 * provenance is admitted, so applyInboundSession routes it by fact:
 *
 * - child (parentSessionId set): the id streamed through another session's
 *   process → child role + `child` stamp, and any wire-only pending buffer
 *   for it moves to childSessions. No sessions_list round trip needed.
 * - own start (startId matched this window's `start`): `local` stamp, and a
 *   buffer that raced in before is re-admitted. Replaces the info-text match.
 * - own resume: `resumed` fill-in (navigation normally stamps it first).
 * - anything else (another window's session): untouched — the existing
 *   pending → sessions_list claim stays the fallback in phase 1, because
 *   stamping it user-facing could let it take a New chat canvas.
 */

import type { BridgeSessionProvenance } from "../bridge/liveBridgeStreamTypes";
import {
  stampProvenance,
  takePendingSession,
  type SessionProvenance,
} from "./sessionProvenance";
import { mergeRoles } from "./sessionRoles";
import { applyInboundSession } from "./sessionStoreLiveInbound";
import type { GetState, SetState } from "./sessionStoreLiveSlice";
import { claimPendingAsChildren } from "./sessionStorePending";

/**
 * Provenance stamp a primary (non-child) assertion maps to.
 * @param p Resolved bridge provenance without a parent.
 * @returns `local` / `resumed` for this window's own start, else null
 *   (foreign sessions keep the heuristic path).
 */
export function ownPrimaryStamp(
  p: BridgeSessionProvenance,
): SessionProvenance | null {
  if (!p.own) {
    return null;
  }
  return p.kind === "resumed" ? "resumed" : "local";
}

/**
 * Record a child assertion: role (unless the parent's own subagent cards
 * already named one), `child` stamp, and claim of any pending buffer.
 * @param set Zustand set. @param get Zustand get.
 * @param sessionId Child session id.
 * @param parentSessionId Parent asserted by the bridge.
 */
function applyChild(
  set: SetState,
  get: GetState,
  sessionId: string,
  parentSessionId: string,
): void {
  const state = get();
  const prevRoles = state.sessionRoles ?? {};
  const roles = prevRoles[sessionId]
    ? prevRoles
    : mergeRoles(prevRoles, {
        [sessionId]: { parentSessionId, sessionKind: "subagent" },
      });
  const claimed = claimPendingAsChildren(
    state.pendingSessions ?? {},
    state.pendingSessionOrder ?? [],
    { ...(state.childSessions ?? {}) },
    { [sessionId]: roles[sessionId] },
    state.sessionProvenance ?? {},
  );
  set({
    sessionRoles: roles,
    sessionProvenance: claimed.provenance,
    pendingSessions: claimed.pending,
    pendingSessionOrder: claimed.order,
    childSessions: claimed.childSessions,
  });
}

/**
 * Stamp this window's own session and re-admit a buffer that was isolated
 * as wire before the assertion arrived.
 * @param set Zustand set. @param get Zustand get.
 * @param sessionId Session this window started / resumed.
 * @param stamp `local` or `resumed`.
 */
function applyOwnPrimary(
  set: SetState,
  get: GetState,
  sessionId: string,
  stamp: SessionProvenance,
): void {
  const state = get();
  const provenance = stampProvenance(state.sessionProvenance, sessionId, stamp);
  const taken = takePendingSession(
    state.pendingSessions ?? {},
    state.pendingSessionOrder ?? [],
    sessionId,
  );
  if (provenance === state.sessionProvenance && !taken.taken) {
    return;
  }
  set({
    sessionProvenance: provenance,
    pendingSessions: taken.pending,
    pendingSessionOrder: taken.order,
  });
  if (taken.taken) {
    // Same re-admission the forceNew info path does for a raced buffer.
    applyInboundSession(set, get, taken.taken);
  }
}

/**
 * Apply one bridge provenance assertion (see module doc).
 * @param set Zustand set.
 * @param get Zustand get.
 * @param sessionId Session the assertion describes; empty ids are ignored.
 * @param provenance Resolved provenance from the dispatcher.
 */
export function applyBridgeProvenance(
  set: SetState,
  get: GetState,
  sessionId: string,
  provenance: BridgeSessionProvenance,
): void {
  if (!sessionId) {
    return;
  }
  const parent = provenance.parentSessionId?.trim();
  if (parent && parent !== sessionId) {
    applyChild(set, get, sessionId, parent);
    return;
  }
  const stamp = ownPrimaryStamp(provenance);
  if (stamp) {
    applyOwnPrimary(set, get, sessionId, stamp);
  }
}
