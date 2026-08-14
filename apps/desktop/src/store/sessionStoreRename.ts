/**
 * Persist a user-chosen session title and lock it against live overwrite.
 */

import {
  renameCatalogSession,
  sanitizeSessionTitle,
} from "@/lib/sessionTitleEdit";
import {
  flushCatalogPersist,
  persistNormalizedCatalog,
} from "./sessionStoreSupport";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
} from "./sessionStoreTypes";

/**
 * Rename one catalog session and, when that chat is on the canvas, stamp
 * the same title onto `session.title` so the top-nav matches the rail.
 * Empty / unknown-id / already-locked-same-title are no-ops.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param id Catalog session id.
 * @param nextTitle Typed title from the rail input (sanitized here).
 */
export function renameSessionAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  id: string,
  nextTitle: string,
): void {
  const title = sanitizeSessionTitle(nextTitle);
  if (!title) {
    return;
  }
  const prev = get().catalog;
  const catalog = renameCatalogSession(prev, id, title);
  if (catalog === prev) {
    return;
  }
  persistNormalizedCatalog(catalog);
  flushCatalogPersist();
  const patch: Partial<SessionStore> = { catalog };
  if (get().session.id === id) {
    patch.session = { ...get().session, title };
  }
  set(patch);
}
