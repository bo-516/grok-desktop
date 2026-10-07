/**
 * Catalog half of disconnectAction: before the bridge is torn down, flush
 * every buffered session into the persisted catalog — unproven pending
 * sessions, buffered subagent children, and the live canvas itself — so
 * nothing streamed on this connection is lost offline. Teardown (pool poll,
 * socket close, disconnected canvas) stays in disconnectAction.
 */

import { normalizeCatalog, upsertFromLiveState } from "./sessionCatalog";
import { flushChildSessionsToCatalog } from "./sessionRoles";
import { flushPendingSessionsToCatalog } from "./sessionStoreLive";
import {
  flushCatalogPersist,
  persistNormalizedCatalog,
} from "./sessionStoreSupport";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/**
 * Persist all buffered sessions and clear the pending buffers.
 * Writes the catalog synchronously (flushCatalogPersist) because the caller
 * tears the bridge down right after. Child buffers are promoted only when a
 * canvas session exists; otherwise they stay in memory untouched.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function flushSessionsForDisconnect(
  set: SessionStoreSet,
  get: SessionStoreGet,
): void {
  const s = get().session;
  // Always flush pending so unproven multi-client sessions are not lost.
  const pendingFlush = flushPendingSessionsToCatalog(
    get().catalog,
    get().pendingSessions,
    get().sessionProvenance,
  );
  const provenance = pendingFlush.provenance;
  let catalog = pendingFlush.catalog;

  if (s.id) {
    // Promote buffered children so L3 drill-down still resolves offline.
    const parentWs: Record<string, string> = {};
    for (const rec of catalog) {
      if (rec.workspace.trim()) {
        parentWs[rec.id] = rec.workspace;
      }
    }
    if (s.workspace.trim()) {
      parentWs[s.id] = s.workspace;
    }
    const flushed = flushChildSessionsToCatalog(
      upsertFromLiveState(catalog, {
        ...s,
        status: "disconnected",
      }),
      get().childSessions,
      get().sessionRoles,
      parentWs,
    );
    catalog = normalizeCatalog(flushed.catalog);
    persistNormalizedCatalog(catalog);
    flushCatalogPersist();
    set({
      catalog,
      childSessions: flushed.remaining,
      pendingSessions: {},
      pendingSessionOrder: [],
      sessionProvenance: provenance,
    });
    return;
  }
  persistNormalizedCatalog(catalog);
  flushCatalogPersist();
  set({
    catalog,
    pendingSessions: {},
    pendingSessionOrder: [],
    sessionProvenance: provenance,
  });
}
