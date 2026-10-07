/**
 * Catalog step of applyInboundSession for user-facing (or viewed child)
 * frames: upsert the session row, retro-tag sibling child rows, promote
 * terminal buffered children, re-heal touched rows and persist on change.
 */

import type { SessionState } from "@grok-desktop/acp-core";
import {
  catalogRefsEqual,
  normalizeCatalogRow,
  upsertFromLiveState,
} from "./sessionCatalog";
import type { SessionRecord } from "./sessionCatalogTypes";
import { stampProvenance, type SessionProvenanceIndex } from "./sessionProvenance";
import {
  promoteChildToCatalog,
  retroTagCatalogRoles,
  terminalChildSessionIds,
  type SessionRoleIndex,
} from "./sessionRoles";
import { persistNormalizedCatalog } from "./sessionStoreSupport";

/**
 * Parent id → workspace from catalog rows (for child noProject heal).
 * @param catalog Current catalog.
 * @returns Map of session id to non-empty workspace.
 */
export function parentWorkspaceMap(
  catalog: SessionRecord[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rec of catalog) {
    if (rec.workspace.trim()) {
      out[rec.id] = rec.workspace;
    }
  }
  return out;
}

/** Inputs for upsertInboundCatalog. */
export type InboundCatalogArgs = {
  /** Catalog before this frame (`get().catalog`); returned as-is when unchanged. */
  prevCatalog: SessionRecord[];
  /** Healed inbound snapshot being admitted. */
  healed: SessionState;
  /** Merged child roles for this frame. */
  roles: SessionRoleIndex;
  /**
   * Per-call child buffer copy. Terminal children promoted into the catalog
   * are deleted from it in place, so the caller's later set() drops them.
   */
  childSessions: Record<string, SessionState>;
  /** Provenance so far; promoted children are re-stamped `child`. */
  provenance: SessionProvenanceIndex;
  /** `passive` keeps catalog recency (select / load); omitted means live. */
  recency?: "live" | "passive";
};

/** Result of upsertInboundCatalog. */
export type InboundCatalogUpsert = {
  /** Next catalog; `=== prevCatalog` when no row changed (nothing persisted). */
  catalog: SessionRecord[];
  /** Provenance after terminal-child stamps. */
  provenance: SessionProvenanceIndex;
};

/**
 * Upsert one user-facing inbound session into the catalog.
 * Persists only when some row object changed; otherwise hands back
 * `prevCatalog` so subscribers see no churn.
 * @param args Previous catalog, healed frame, roles and the mutable child buffer.
 * @returns Next catalog and provenance; never calls set() itself.
 */
export function upsertInboundCatalog(
  args: InboundCatalogArgs,
): InboundCatalogUpsert {
  const { prevCatalog, healed, roles, childSessions, recency } = args;
  const upserted = upsertFromLiveState(
    prevCatalog,
    healed,
    Date.now(),
    recency ? { recency } : undefined,
  );
  // Retro-tag siblings that may already sit in the catalog without kind.
  const parentWs = parentWorkspaceMap(upserted);
  let catalog = retroTagCatalogRoles(upserted, roles, parentWs);
  let provenance = args.provenance;
  // Promote terminal children buffered from earlier streaming frames.
  for (const childId of terminalChildSessionIds(healed)) {
    const buffered = childSessions[childId];
    const role = roles[childId];
    if (!buffered || !role) {
      continue;
    }
    catalog = promoteChildToCatalog(
      catalog,
      buffered,
      role,
      healed.workspace || parentWs[role.parentSessionId] || "",
    );
    delete childSessions[childId];
    // Terminal promote keeps the row in catalog for L3 but rail still hides
    // subagent kinds; provenance stays child.
    provenance = stampProvenance(provenance, childId, "child");
  }
  // Hot path: only re-heal rows that changed identity (id present in roles
  // or the upserted parent), not a full normalizeCatalog walk.
  if (catalog !== prevCatalog) {
    catalog = catalog.map((rec) => {
      if (rec.id === healed.id || roles[rec.id]) {
        return normalizeCatalogRow(rec);
      }
      return rec;
    });
  }
  // Reuse prior array reference when every slot is the same object (no churn).
  if (catalogRefsEqual(prevCatalog, catalog)) {
    catalog = prevCatalog;
  } else {
    persistNormalizedCatalog(catalog);
  }
  return { catalog, provenance };
}
