/**
 * sessions_list → catalog merge + provenance claim for pending buffers.
 * Split from sessionStoreLive so connect/start stays under the line limit.
 */

import {
  isSubagentSessionKind,
  mergeRemoteSessionsIntoCatalog,
  normalizeSessionsList,
} from "../lib/sessionActions";
import { normalizeCatalog } from "./sessionCatalog";
import {
  mergeRoles,
  retroTagCatalogRoles,
  rolesFromRemoteRows,
} from "./sessionRoles";
import { stampProvenance } from "./sessionProvenance";
import {
  promotePendingToCatalog,
  type GetState,
  type SetState,
} from "./sessionStoreLiveInbound";
import { persistNormalizedCatalog } from "./sessionStoreSupport";
import type { LiveHandle } from "./sessionStoreLiveTypes";

/**
 * Fetch upstream sessions (all workspaces) and merge into the local catalog.
 * Used on connect, by the Sync sessions menu, and when pendingSessions need
 * reclassification. Empty remote does not clear local rows. Failures are
 * silent so a flaky CLI does not block the UI.
 *
 * Non-subagent remote rows stamp `disk` provenance and claim matching pending
 * buffers into the catalog. Subagent rows stamp `child` and go to roles only.
 *
 * @param bridge Live bridge handle with `cli`.
 * @param set Zustand set for catalog write-back.
 * @param get Zustand get for the current catalog snapshot.
 */
export async function syncCatalogFromBridge(
  bridge: LiveHandle,
  set: SetState,
  get: GetState,
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    // Omit cwd so the bridge returns every workspace under ~/.grok/sessions.
    const result = await bridge.cli("sessions_list", {});
    if (!result.ok) {
      return {
        ok: false,
        count: 0,
        error: result.error ?? "sessions_list failed",
      };
    }
    const rows = normalizeSessionsList(result.data);
    // mergeRemoteSessionsIntoCatalog already ends with normalizeCatalog.
    let catalog = mergeRemoteSessionsIntoCatalog(get().catalog, rows);
    // Disk session_kind complements live subagent cards (I2 dual source).
    const roles = mergeRoles(
      get().sessionRoles ?? {},
      rolesFromRemoteRows(rows),
    );
    let provenance = get().sessionProvenance ?? {};
    const userFacingRemoteIds: string[] = [];
    for (const row of rows) {
      if (isSubagentSessionKind(row.sessionKind)) {
        provenance = stampProvenance(provenance, row.id, "child");
      } else {
        provenance = stampProvenance(provenance, row.id, "disk");
        userFacingRemoteIds.push(row.id);
      }
    }
    // Claim pending buffers that sessions_list proved are ordinary chats.
    const pending = { ...(get().pendingSessions ?? {}) };
    let pendingOrder = [...(get().pendingSessionOrder ?? [])];
    let childSessions = { ...(get().childSessions ?? {}) };
    for (const id of userFacingRemoteIds) {
      const buf = pending[id];
      if (buf) {
        catalog = promotePendingToCatalog(catalog, buf);
        delete pending[id];
        pendingOrder = pendingOrder.filter((x) => x !== id);
      }
    }
    // Known-child pending → childSessions (roles from disk).
    for (const id of Object.keys(roles)) {
      const buf = pending[id];
      if (!buf) {
        continue;
      }
      childSessions = { ...childSessions, [id]: buf };
      delete pending[id];
      pendingOrder = pendingOrder.filter((x) => x !== id);
      provenance = stampProvenance(provenance, id, "child");
    }
    const parentWs: Record<string, string> = {};
    for (const rec of catalog) {
      if (rec.workspace.trim()) {
        parentWs[rec.id] = rec.workspace;
      }
    }
    catalog = retroTagCatalogRoles(catalog, roles, parentWs);
    catalog = normalizeCatalog(catalog);
    persistNormalizedCatalog(catalog);
    set({
      catalog,
      sessionRoles: roles,
      sessionProvenance: provenance,
      pendingSessions: pending,
      pendingSessionOrder: pendingOrder,
      childSessions,
      catalogRevision: (get().catalogRevision ?? 0) + 1,
    });
    return { ok: true, count: rows.length };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
