/**
 * sessions_list → disk membership for the rail.
 * A successful read replaces which sessions exist. A failed read leaves the
 * in-memory list alone so a dropped socket cannot blank the rail.
 * The list is not written to localStorage; the next launch reads disk again.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  isSubagentSessionKind,
  normalizeSessionsList,
} from "../lib/sessionActions";
import type { SessionRecord } from "./sessionCatalog";
import {
  catalogKeepIds,
  reconcileCatalogWithDisk,
  stabilizeCatalogView,
} from "./sessionCatalogDisk";
import {
  mergeRoles,
  retroTagCatalogRoles,
  rolesFromRemoteRows,
  type SessionRoleIndex,
} from "./sessionRoles";
import {
  stampProvenance,
  type SessionProvenanceIndex,
} from "./sessionProvenance";
import {
  promotePendingToCatalog,
  type GetState,
  type LiveStoreSlice,
  type SetState,
} from "./sessionStoreLiveInbound";
import { INITIAL_SESSION } from "./sessionStoreSupport";
import type { LiveHandle } from "./sessionStoreLiveTypes";

/**
 * Claim pending buffers that this disk list proved, and retag child rows.
 * Lets stay inside this helper so the sync function can stay const-only.
 * @param catalog Catalog after disk membership reconcile.
 * @param rows Normalized disk rows (already walked once by the caller for ids).
 * @param roles Merged role index. Keys with a pending buffer become children.
 * @param provenance Provenance map before this list. Not mutated.
 * @param pending Pending buffers. Copied; claimed ids are removed on the copy.
 * @param pendingOrder Oldest-first pending ids. Copied; claimed ids are removed.
 * @param childSessions Known child buffers. Copied; claimed children are added.
 * @returns Next catalog plus the pending / provenance maps to write.
 */
function claimListedSessions(args: {
  catalog: SessionRecord[];
  rows: ReturnType<typeof normalizeSessionsList>;
  roles: SessionRoleIndex;
  provenance: SessionProvenanceIndex;
  pending: Record<string, SessionState>;
  pendingOrder: string[];
  childSessions: Record<string, SessionState>;
}): {
  catalog: SessionRecord[];
  provenance: SessionProvenanceIndex;
  pending: Record<string, SessionState>;
  pendingOrder: string[];
  childSessions: Record<string, SessionState>;
} {
  const userFacingRemoteIds: string[] = [];
  const pending = { ...args.pending };
  let catalog = args.catalog;
  let provenance = args.provenance;
  let pendingOrder = [...args.pendingOrder];
  let childSessions = { ...args.childSessions };
  for (const row of args.rows) {
    if (isSubagentSessionKind(row.sessionKind)) {
      provenance = stampProvenance(provenance, row.id, "child");
    } else {
      provenance = stampProvenance(provenance, row.id, "disk");
      userFacingRemoteIds.push(row.id);
    }
  }
  for (const id of userFacingRemoteIds) {
    const buf = pending[id];
    if (buf) {
      catalog = promotePendingToCatalog(catalog, buf);
      delete pending[id];
      pendingOrder = pendingOrder.filter((x) => x !== id);
    }
  }
  for (const id of Object.keys(args.roles)) {
    const buf = pending[id];
    if (!buf) {
      continue;
    }
    childSessions = { ...childSessions, [id]: buf };
    delete pending[id];
    pendingOrder = pendingOrder.filter((x) => x !== id);
    provenance = stampProvenance(provenance, id, "child");
  }
  catalog = retroTagCatalogRoles(
    catalog,
    args.roles,
    parentWorkspaces(catalog),
  );
  return { catalog, provenance, pending, pendingOrder, childSessions };
}

/**
 * Parent id → workspace for child no-project heal.
 * @param catalog Rows after pending claim. Empty workspace is skipped.
 * @returns Map used by retroTagCatalogRoles.
 */
function parentWorkspaces(catalog: SessionRecord[]): Record<string, string> {
  const parentWs: Record<string, string> = {};
  for (const rec of catalog) {
    if (rec.workspace.trim()) {
      parentWs[rec.id] = rec.workspace;
    }
  }
  return parentWs;
}

/**
 * Fetch every workspace under ~/.grok/sessions and make that the rail.
 * Used on connect, by the Sync sessions menu, by the idle refresh, and when
 * pending buffers need reclassification.
 *
 * Success: disk ids replace membership. In-memory timeline / locked title stay
 * on ids that still exist. A live pool process, a pending buffer, or a canvas
 * that is creating or mid-turn is kept even when its folder is not listed yet.
 * An empty success clears every other row (the sessions directory is gone).
 * Failure: the in-memory list is left as-is.
 *
 * When the open chat disappears, the canvas is cleared. The idle refresh does
 * not jump to a different chat.
 *
 * A read that would paint the same titles, projects, order, and relative
 * times does not call `set`. The rail stays on the same catalog reference
 * so the list does not re-render or jump.
 *
 * @param bridge Live bridge handle with `cli`.
 * @param set Zustand set for catalog write-back.
 * @param get Zustand get for the current catalog snapshot.
 * @returns ok false on CLI failure; count is the number of disk rows.
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
    const state = get();
    const pendingIds = Object.keys(state.pendingSessions ?? {});
    const keepIds = catalogKeepIds({
      pendingSessionIds: pendingIds,
      poolEntries: state.poolEntries,
      creatingSession: state.creatingSession,
      sessionId: state.session?.id,
      sessionStatus: state.session?.status,
    });
    const roles = mergeRoles(
      state.sessionRoles ?? {},
      rolesFromRemoteRows(rows),
    );
    const reconciled = reconcileCatalogWithDisk(state.catalog, rows, keepIds);
    const claimed = claimListedSessions({
      catalog: reconciled,
      rows,
      roles,
      provenance: state.sessionProvenance ?? {},
      pending: { ...(state.pendingSessions ?? {}) },
      pendingOrder: [...(state.pendingSessionOrder ?? [])],
      childSessions: { ...(state.childSessions ?? {}) },
    });
    const provenance = claimed.provenance;
    const pending = claimed.pending;
    const pendingOrder = claimed.pendingOrder;
    const childSessions = claimed.childSessions;
    const catalog = stabilizeCatalogView(state.catalog, claimed.catalog);
    const pendingSame =
      pendingOrder.length === (state.pendingSessionOrder ?? []).length &&
      pendingOrder.every((id, index) => id === state.pendingSessionOrder?.[index]);
    const viewing = state.viewingSessionId ?? null;
    const viewingGone =
      Boolean(viewing) && !catalog.some((row) => row.id === viewing);
    // Same reference means the rail would paint the same pixels. Do not set.
    if (!viewingGone && pendingSame && catalog === state.catalog) {
      return { ok: true, count: rows.length };
    }
    const patch: Partial<LiveStoreSlice> = {
      catalog,
      sessionRoles: roles,
      sessionProvenance: provenance,
      pendingSessions: pending,
      pendingSessionOrder: pendingOrder,
      childSessions,
      catalogRevision: (state.catalogRevision ?? 0) + 1,
    };
    if (viewingGone && viewing) {
      patch.viewingSessionId = null;
      patch.viewingSubagent = false;
      patch.viewingParentSessionId = undefined;
      if (state.activeSessionId === viewing) {
        patch.activeSessionId = null;
      }
      if (state.session?.id === viewing) {
        patch.session = INITIAL_SESSION;
      }
      if (state.restoringSessionId === viewing) {
        patch.restoringSessionId = null;
      }
    }
    set(patch);
    return { ok: true, count: rows.length };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
