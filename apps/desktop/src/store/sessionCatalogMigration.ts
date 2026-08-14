/**
 * Catalog schema migrations for session provenance whitelist.
 * v1 → v2: untagged pre-refactor child rows become pending-visible-as-child
 * so the rail stays clean without hard-deleting drill-down history.
 */

import { isSubagentSessionKind } from "@/lib/sessionActions";
import type { SessionRecord } from "./sessionCatalogTypes";

/** Current catalog row schema written by this client. */
export const CATALOG_SCHEMA_VERSION = 2;

/**
 * v1 → v2 migration result.
 * `needsProbe` ids should be reclassified via sessions_list (empty workspace +
 * never selected heuristic only demotes, never hard-deletes).
 */
export type CatalogMigrationResult = {
  /** Migrated catalog rows (schemaVersion stamped). */
  catalog: SessionRecord[];
  /** Ids that need a network sessions_list claim (demoted ghosts). */
  needsProbe: string[];
};

/**
 * Collect childSessionId values from every parent row's subagents snapshot.
 * Deterministic clue (1) for tagging pre-refactor ghost rows.
 * @param catalog Raw catalog from storage.
 * @returns Set of known child session ids.
 */
export function childIdsFromSubagentSnapshots(
  catalog: SessionRecord[],
): Set<string> {
  const out = new Set<string>();
  for (const rec of catalog) {
    const cards = rec.subagents;
    if (!cards) {
      continue;
    }
    for (const card of Object.values(cards)) {
      const childId = card.childSessionId?.trim();
      if (childId && childId !== rec.id) {
        out.add(childId);
      }
    }
  }
  return out;
}

/**
 * Whether a row looks like an untagged harness child left by the pre-whitelist
 * client: empty workspace, noProject, weak/empty timeline, and not already
 * tagged. Clue (2) — demote only, never hard-delete.
 * @param rec Catalog row.
 * @returns True when the row should be treated as pending until sessions_list.
 */
export function looksLikeUntaggedChildGhost(rec: SessionRecord): boolean {
  if (isSubagentSessionKind(rec.sessionKind)) {
    return false;
  }
  if (rec.parentSessionId) {
    return false;
  }
  if (rec.workspace.trim()) {
    return false;
  }
  if (!rec.noProject) {
    return false;
  }
  // Real user "no project" chats almost always have timeline content.
  if ((rec.timeline?.length ?? 0) > 0) {
    return false;
  }
  return true;
}

/**
 * Migrate a catalog loaded from storage up to {@link CATALOG_SCHEMA_VERSION}.
 * Idempotent: running twice yields the same shape.
 *
 * v1 → v2:
 *  1) Any id present in a parent subagents snapshot → stamp subagent + parent.
 *  2) Empty workspace + noProject + empty timeline (untagged) → stamp as
 *     subagent with empty parent so the rail hides it; add to needsProbe for
 *     sessions_list reclassification (user correction path: Sync sessions).
 *
 * Never deletes rows so selectSession(childId) still resolves offline.
 *
 * @param catalog Raw rows from localStorage (any schemaVersion / missing).
 * @returns Migrated catalog + ids that need network probe.
 */
export function migrateCatalogToCurrent(
  catalog: SessionRecord[],
): CatalogMigrationResult {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { catalog: catalog ?? [], needsProbe: [] };
  }

  // Already at current version: still re-run tagging for safety (idempotent).
  const knownChildren = childIdsFromSubagentSnapshots(catalog);
  // Parent id for a known child: first parent whose subagents map lists it.
  const parentOf = new Map<string, string>();
  for (const rec of catalog) {
    const cards = rec.subagents;
    if (!cards) {
      continue;
    }
    for (const card of Object.values(cards)) {
      const childId = card.childSessionId?.trim();
      if (childId && !parentOf.has(childId)) {
        parentOf.set(childId, rec.id);
      }
    }
  }

  const needsProbe: string[] = [];
  let changed = false;
  const next = catalog.map((rec) => {
    let row = rec;
    const alreadyCurrent = rec.schemaVersion === CATALOG_SCHEMA_VERSION;

    // Clue (1): listed in a parent subagents snapshot.
    if (knownChildren.has(rec.id) && !isSubagentSessionKind(rec.sessionKind)) {
      changed = true;
      row = {
        ...row,
        sessionKind: "subagent",
        parentSessionId: parentOf.get(rec.id) ?? row.parentSessionId,
        schemaVersion: CATALOG_SCHEMA_VERSION,
      };
      return row;
    }

    // Clue (2): empty no-project ghost without kind → hide as subagent pending.
    if (looksLikeUntaggedChildGhost(rec)) {
      changed = true;
      needsProbe.push(rec.id);
      row = {
        ...row,
        sessionKind: row.sessionKind ?? "subagent",
        schemaVersion: CATALOG_SCHEMA_VERSION,
      };
      return row;
    }

    if (!alreadyCurrent) {
      changed = true;
      return { ...row, schemaVersion: CATALOG_SCHEMA_VERSION };
    }
    return row;
  });

  return {
    catalog: changed ? next : catalog,
    needsProbe,
  };
}

/**
 * v1 → v2 entry used by hydrate; alias kept for test readability.
 * @param catalog Raw catalog from storage.
 */
export function migrateCatalogV1toV2(
  catalog: SessionRecord[],
): CatalogMigrationResult {
  return migrateCatalogToCurrent(catalog);
}
