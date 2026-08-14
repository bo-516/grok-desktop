/**
 * Pending (wire-only) session claim paths: deferred sessions_list sync and
 * disconnect flush. Keeps sessionStoreLive under the line limit.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  normalizeCatalog,
  normalizeCatalogRow,
  upsertFromLiveState,
} from "./sessionCatalog";
import {
  stampProvenance,
  takePendingSession,
  type SessionProvenanceIndex,
} from "./sessionProvenance";
import type { SessionRoleIndex } from "./sessionRoles";
import type { SessionRecord } from "./sessionCatalogTypes";
import type { LiveHandle } from "./sessionStoreLiveTypes";

/**
 * Minimal get shape for deferred pending sync.
 * Uses a structural type so this module does not import LiveStoreSlice
 * (avoids a cycle with sessionStoreLiveInbound).
 */
type PendingGet = () => {
  pendingSessions?: Record<string, SessionState>;
  [key: string]: unknown;
};

/**
 * Minimal set shape: accepts the Zustand partial form without importing SetState.
 * @param partial Patch object or updater (typed loosely for cycle-free scheduling).
 */
type PendingSet = (
  partial:
    | Record<string, unknown>
    | ((state: Record<string, unknown>) => Record<string, unknown>),
) => void;

/**
 * Promote one pending buffer into the catalog as a user-facing disk row.
 * Used when eviction would otherwise drop an unproven id, and on disconnect flush.
 * @param catalog Current catalog.
 * @param state Pending SessionState.
 * @param now Wall clock for new-row timestamps.
 * @returns Catalog after upsert + single-row normalize.
 */
export function promotePendingToCatalog(
  catalog: SessionRecord[],
  state: SessionState,
  now = Date.now(),
): SessionRecord[] {
  const next = upsertFromLiveState(catalog, state, now);
  return next.map((rec) =>
    rec.id === state.id ? normalizeCatalogRow(rec) : rec,
  );
}

/**
 * Claim pending buffers that now appear in the role index (subagent_spawned).
 * Moves them into childSessions and stamps child provenance.
 * @param pending Pending map.
 * @param order Pending order.
 * @param childSessions Known-child buffers.
 * @param roles Role index after merge.
 * @param provenance Provenance index.
 * @returns Updated maps after claim.
 */
export function claimPendingAsChildren(
  pending: Record<string, SessionState>,
  order: string[],
  childSessions: Record<string, SessionState>,
  roles: SessionRoleIndex,
  provenance: SessionProvenanceIndex,
): {
  pending: Record<string, SessionState>;
  order: string[];
  childSessions: Record<string, SessionState>;
  provenance: SessionProvenanceIndex;
} {
  let nextPending = pending;
  let nextOrder = order;
  let nextChildren = childSessions;
  let nextProv = provenance;
  for (const id of Object.keys(roles)) {
    if (!(id in nextPending)) {
      nextProv = stampProvenance(nextProv, id, "child");
      continue;
    }
    const taken = takePendingSession(nextPending, nextOrder, id);
    nextPending = taken.pending;
    nextOrder = taken.order;
    if (taken.taken) {
      nextChildren = { ...nextChildren, [id]: taken.taken };
    }
    nextProv = stampProvenance(nextProv, id, "child");
  }
  return {
    pending: nextPending,
    order: nextOrder,
    childSessions: nextChildren,
    provenance: nextProv,
  };
}

/** Quiet window before pending sessions trigger a sessions_list claim (ms). */
export const PENDING_SYNC_QUIET_MS = 3000;

/** Timer for deferred pending → sessions_list claim. */
let pendingSyncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a single sessions_list sync when pendingSessions are non-empty.
 * Debounced to PENDING_SYNC_QUIET_MS so mid-fanout does not hammer CLI.
 * @param bridge Live handle.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param syncFn The catalog sync implementation (injected to avoid cycles).
 */
export function schedulePendingSessionsSync(
  bridge: LiveHandle,
  set: PendingSet,
  get: PendingGet,
  syncFn: (
    bridge: LiveHandle,
    set: PendingSet,
    get: PendingGet,
  ) => Promise<unknown>,
): void {
  const pending = get().pendingSessions ?? {};
  if (Object.keys(pending).length === 0) {
    return;
  }
  if (pendingSyncTimer !== null) {
    return;
  }
  pendingSyncTimer = setTimeout(() => {
    pendingSyncTimer = null;
    if (Object.keys(get().pendingSessions ?? {}).length === 0) {
      return;
    }
    void syncFn(bridge, set, get);
  }, PENDING_SYNC_QUIET_MS);
}

/**
 * Cancel deferred pending sync (disconnect).
 */
export function cancelPendingSessionsSync(): void {
  if (pendingSyncTimer !== null) {
    clearTimeout(pendingSyncTimer);
    pendingSyncTimer = null;
  }
}

/**
 * Flush every pending buffer into the catalog as disk (conservative).
 * Used on disconnect / page hide so no user session is dropped.
 * @param catalog Current catalog.
 * @param pending Pending buffers.
 * @param provenance Provenance index.
 * @returns catalog + provenance after promote; pending emptied.
 */
export function flushPendingSessionsToCatalog(
  catalog: SessionRecord[],
  pending: Record<string, SessionState>,
  provenance: SessionProvenanceIndex,
): {
  catalog: SessionRecord[];
  provenance: SessionProvenanceIndex;
} {
  let nextCatalog = catalog;
  let nextProv = provenance;
  for (const [, state] of Object.entries(pending)) {
    nextProv = stampProvenance(nextProv, state.id, "disk");
    nextCatalog = promotePendingToCatalog(nextCatalog, state);
  }
  return {
    catalog: normalizeCatalog(nextCatalog),
    provenance: nextProv,
  };
}
