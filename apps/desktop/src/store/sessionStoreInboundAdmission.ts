/**
 * Admission steps of applyInboundSession (I2): heal the frame, derive
 * roles / provenance / spawn claims, and buffer anything that is not
 * user-facing — known children into childSessions, unproven wire ids into
 * pendingSessions — without entering the catalog path.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import { loadWorkspacePrefs } from "../lib/workspacePrefs";
import { normalizeCatalogRow } from "./sessionCatalog";
import {
  putPendingSession,
  stampProvenance,
  stampProvenanceMany,
  type SessionProvenanceIndex,
} from "./sessionProvenance";
import {
  mergeRoles,
  retroTagCatalogRoles,
  rolesFromSubagents,
  type SessionRoleIndex,
} from "./sessionRoles";
import { parentWorkspaceMap } from "./sessionStoreInboundCatalog";
import { preserveLocalUserMedia } from "./sessionStoreLiveFollow";
import type { GetState, LiveStoreSlice, SetState } from "./sessionStoreLiveSlice";
import {
  claimPendingAsChildren,
  promotePendingToCatalog,
} from "./sessionStorePending";
import {
  healSessionTimeline,
  persistNormalizedCatalog,
} from "./sessionStoreSupport";
import { isolatedInboundOutcome, type InboundOutcome } from "./sessionTurnEdge";

/** Per-call admission working set threaded through applyInboundSession. */
export type InboundAdmission = {
  /** Store roles merged with this frame's first-hand subagent roles. */
  roles: SessionRoleIndex;
  /** Provenance after child stamps and spawn claims. */
  provenance: SessionProvenanceIndex;
  /** Wire-only buffers after spawn claims. */
  pending: Record<string, SessionState>;
  /** Oldest-first order of `pending`. */
  pendingOrder: string[];
  /**
   * Child reduce buffers after spawn claims. A per-call copy of the store
   * map, so later steps may edit it in place before it is written by set().
   */
  childSessions: Record<string, SessionState>;
};

/**
 * Normalize an inbound snapshot before routing.
 * @param session SessionState after heal-ready reduce / hydrate.
 * @param canvas Current canvas session (`get().session`), source of local media.
 * @returns Healed snapshot; workspace is blanked when the user chose no project.
 */
export function healInboundSession(
  session: SessionState,
  canvas: SessionState,
): SessionState {
  /** Snapshot with legacy duplicate seed rows normalized before routing. */
  const healedTimeline = healSessionTimeline(session);
  // User chose "work without a project": bridge still has a default
  // cwd for the agent process, but do not let that overwrite the UI
  // selection or catalog grouping a few seconds later.
  const healedBase = loadWorkspacePrefs().noProject
    ? { ...healedTimeline, workspace: "" }
    : healedTimeline;
  /*
   * Live reduce only has text echoes of prompts; optimistic paint already
   * holds image ContentBlocks. Merge media onto the same-session canvas
   * before catalog upsert so thumbs survive mid-turn and disk cache.
   */
  return preserveLocalUserMedia(healedBase, canvas);
}

/**
 * Derive roles and provenance for one frame and claim pending spawns.
 * Pure over the given slice: reads only, never calls set().
 * @param state Current store slice (`get()`).
 * @param healed Healed inbound snapshot.
 * @returns Fresh admission working set for the routing steps.
 */
export function admitInboundRoles(
  state: LiveStoreSlice,
  healed: SessionState,
): InboundAdmission {
  // Parent subagents are the first-hand role source (before sessions_list).
  const prevRoles = state.sessionRoles ?? {};
  const roles = mergeRoles(prevRoles, rolesFromSubagents(healed));
  // Child stamps from roles; forceNew `local` is stamped only from bridge
  // `info` (session <id> ready) — never from empty inbound state frames
  // (wire children share that empty-timeline shape and would hijack New chat).
  const provenance = stampProvenanceMany(
    state.sessionProvenance ?? {},
    Object.keys(roles),
    "child",
  );
  // Spawn claim: pending id that just got a role → child buffer.
  const claimed = claimPendingAsChildren(
    state.pendingSessions ?? {},
    state.pendingSessionOrder ?? [],
    { ...(state.childSessions ?? {}) },
    roles,
    provenance,
  );
  return {
    roles,
    provenance: claimed.provenance,
    pending: claimed.pending,
    pendingOrder: claimed.order,
    childSessions: claimed.childSessions,
  };
}

/**
 * Known child not being viewed: buffer in childSessions, retro-tag any
 * catalog row created out of order for it, and stop (no canvas follow).
 * @param set Zustand set. @param get Zustand get.
 * @param healed Healed inbound child snapshot.
 * @param admission Working set from admitInboundRoles.
 * @returns Isolated outcome (no follow, no turn settle).
 */
function bufferKnownChildInbound(
  set: SetState,
  get: GetState,
  healed: SessionState,
  admission: InboundAdmission,
): InboundOutcome {
  const { roles, provenance, pending, pendingOrder } = admission;
  const childSessions = { ...admission.childSessions, [healed.id]: healed };
  // Retro-tag any catalog row already created out of order for this child.
  const parentWs = parentWorkspaceMap(get().catalog);
  const tagged = retroTagCatalogRoles(get().catalog, roles, parentWs);
  const catalogChanged = tagged !== get().catalog;
  if (catalogChanged) {
    const healedRows = tagged.map((r) =>
      roles[r.id] ? normalizeCatalogRow(r) : r,
    );
    persistNormalizedCatalog(healedRows);
    set({
      sessionRoles: roles,
      sessionProvenance: provenance,
      childSessions,
      pendingSessions: pending,
      pendingSessionOrder: pendingOrder,
      catalog: healedRows,
      catalogRevision: (get().catalogRevision ?? 0) + 1,
    });
    return isolatedInboundOutcome(healed.id);
  }
  set({
    sessionRoles: roles,
    sessionProvenance: provenance,
    childSessions,
    pendingSessions: pending,
    pendingSessionOrder: pendingOrder,
  });
  return isolatedInboundOutcome(healed.id);
}

/**
 * Wire-only (unproven) id: pending isolation, never localStorage until
 * claimed. A capacity eviction flushes the evicted buffer to the catalog
 * as `disk` first so a real multi-client session is not dropped.
 * @param set Zustand set. @param get Zustand get.
 * @param healed Healed inbound snapshot with no user-facing provenance.
 * @param admission Working set from admitInboundRoles.
 * @returns Isolated outcome (no follow, no turn settle).
 */
function bufferWireOnlyInbound(
  set: SetState,
  get: GetState,
  healed: SessionState,
  admission: InboundAdmission,
): InboundOutcome {
  const put = putPendingSession(
    admission.pending,
    healed.id,
    healed,
    admission.pendingOrder,
  );
  let provenance = admission.provenance;
  let catalog = get().catalog;
  let rev = get().catalogRevision ?? 0;
  if (put.evictId && put.evicted) {
    // Flush-before-evict so capacity cannot drop a real multi-client session.
    provenance = stampProvenance(provenance, put.evictId, "disk");
    catalog = promotePendingToCatalog(catalog, put.evicted);
    rev += 1;
    persistNormalizedCatalog(catalog);
  }
  set({
    sessionRoles: admission.roles,
    sessionProvenance: provenance,
    childSessions: admission.childSessions,
    pendingSessions: put.pending,
    pendingSessionOrder: put.order,
    ...(catalog !== get().catalog
      ? { catalog, catalogRevision: rev }
      : {}),
  });
  return isolatedInboundOutcome(healed.id);
}

/**
 * Isolate a non-user-facing frame (unproven wire id, or a known child that
 * is not being viewed): buffer it without catalog upsert or canvas paint.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param healed Healed inbound snapshot.
 * @param admission Working set from admitInboundRoles.
 * @param isKnownChild True when roles already list `healed.id` as a child.
 * @returns Isolated outcome for the live apply site.
 */
export function isolateInboundSession(
  set: SetState,
  get: GetState,
  healed: SessionState,
  admission: InboundAdmission,
  isKnownChild: boolean,
): InboundOutcome {
  if (isKnownChild) {
    return bufferKnownChildInbound(set, get, healed, admission);
  }
  return bufferWireOnlyInbound(set, get, healed, admission);
}
