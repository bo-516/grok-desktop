/**
 * Promote a buffered / role-only child into the catalog so selectSession
 * can resolve L3 drill-down ids that are not yet persisted rows.
 */

import { createSessionState } from "@grok-desktop/acp-core";
import { normalizeCatalog } from "./sessionCatalog";
import { promoteChildToCatalog } from "./sessionRoles";
import { persistNormalizedCatalog } from "./sessionStoreSupport";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/**
 * If `id` is a known child (buffer or roles) missing from the catalog,
 * promote a row so the subsequent catalog.find in selectSession succeeds.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param id Session id the user asked to open (may be a childSessionId).
 */
export function promoteBufferedChildForSelect(
  set: SessionStoreSet,
  get: SessionStoreGet,
  id: string,
): void {
  const role = get().sessionRoles?.[id];
  const buffered = get().childSessions?.[id];
  const alreadyInCatalog = get().catalog.some((s) => s.id === id);
  if (!role || (!buffered && alreadyInCatalog)) {
    return;
  }
  const parentWs =
    get().catalog.find((s) => s.id === role.parentSessionId)?.workspace ?? "";
  const child =
    buffered ??
    createSessionState({
      id,
      workspace: parentWs,
    });
  const nextCatalog = normalizeCatalog(
    promoteChildToCatalog(get().catalog, child, role, parentWs),
  );
  const restChildren = { ...get().childSessions };
  delete restChildren[id];
  persistNormalizedCatalog(nextCatalog);
  set({ catalog: nextCatalog, childSessions: restChildren });
}
