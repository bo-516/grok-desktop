/**
 * Overview row projection: catalog + pool → healed, rail-filtered rows.
 */

import type { SessionStatus } from "@grok-desktop/acp-core";
import {
  filterCatalogForSessionRail,
  isSubagentSessionKind,
} from "@/lib/sessionActions";
import type { SessionRecord } from "@/store/sessionCatalog";
import type { OverviewSession } from "@/lib/multiSession";

/** Pool row fields Overview needs; extra pool fields are ignored. */
export type OverviewPoolEntry = {
  sessionId: string;
  status: SessionStatus | string;
  live?: boolean;
};

/** Optional canvas + role inputs when projecting catalog rows. */
export type OverviewBuildOpts = {
  /** Focused canvas; `waiting_permission` here still shows Allow/Deny. */
  canvas?: { id: string; status: SessionStatus | string };
  /**
   * childSessionId → role. Hides children whose catalog `sessionKind` is
   * not stamped yet (same hide policy as the rail after retro-tag).
   */
  sessionRoles?: Record<string, { sessionKind?: string }>;
};

/**
 * Whether this pool row is a live busy process (streaming or permission).
 * Matches footer "N running" for streaming; permission is Overview-only.
 * @param pool Pool snapshot for one session id; missing / not live is idle.
 * @returns True when Overview may paint a busy bucket from the pool.
 */
function isLiveBusyPool(
  pool?: Pick<OverviewPoolEntry, "status" | "live">,
): boolean {
  if (pool?.live !== true) {
    return false;
  }
  return (
    pool.status === "streaming" || pool.status === "waiting_permission"
  );
}

/**
 * Canvas-facing status for one Overview row.
 * Live busy pool wins. Catalog `streaming` / `waiting_permission` without a
 * live process is stale and paints idle — same heal as `recordToSessionState`.
 * @param catalogStatus Persisted catalog status (often stale after a turn).
 * @param pool Live pool row for this id, if any. Omit when not listed.
 * @returns Healed status plus the pool `live` flag (undefined when no row).
 */
export function resolveOverviewPaintStatus(
  catalogStatus: SessionStatus | string,
  pool?: Pick<OverviewPoolEntry, "status" | "live">,
): { status: SessionStatus | string; live?: boolean } {
  /** Echoed onto the row so WORKING can require `live === true`. */
  const live = pool?.live;
  if (isLiveBusyPool(pool) && pool) {
    return { status: pool.status, live: true };
  }
  if (
    catalogStatus === "streaming" ||
    catalogStatus === "waiting_permission"
  ) {
    // Stale catalog busy, or a non-live / non-busy pool resident.
    if (
      pool?.status !== undefined &&
      pool.status !== "streaming" &&
      pool.status !== "waiting_permission"
    ) {
      return { status: pool.status, live };
    }
    return { status: "idle", live };
  }
  return { status: pool?.status ?? catalogStatus, live };
}

/**
 * Project catalog + pool into Overview rows.
 * Hides harness subagents and empty drafts (same list as the session rail)
 * and heals stale catalog busy statuses against the live pool.
 * @param catalog Full catalog including subagent rows (those stay selectable).
 * @param poolEntries Current `list_pool` snapshot; missing id means not live.
 * @param opts Focused canvas + role index. Wrong/omitted roles only fail
 *   closed for already-stamped `sessionKind` rows (rail filter still hides).
 * @returns Rows ready to search / group / cap; status is the healed paint
 *   value and `updatedAt` is the catalog last-activity stamp.
 */
export function buildOverviewSessions(
  catalog: SessionRecord[],
  poolEntries: OverviewPoolEntry[],
  opts?: OverviewBuildOpts,
): OverviewSession[] {
  /** Role index; missing means only catalog `sessionKind` can hide a child. */
  const roles = opts?.sessionRoles;
  /** Rail-visible chats, plus any role-stamped children the catalog missed. */
  const listed = filterCatalogForSessionRail(catalog).filter((row) => {
    const roleKind = roles?.[row.id]?.sessionKind;
    return !isSubagentSessionKind(roleKind);
  });
  /** sessionId → pool row; catalog ids not present are treated as not live. */
  const poolMap = new Map(poolEntries.map((e) => [e.sessionId, e]));
  /** Focused canvas; used only for the permission override. */
  const canvas = opts?.canvas;
  return listed.map((c) => {
    /** Live pool row for this catalog id, if the process is still resident. */
    const pe = poolMap.get(c.id);
    /** Healed status; catalog streaming without a live busy pool becomes idle. */
    const paint = resolveOverviewPaintStatus(c.status, pe);
    /** Canvas waiting on permission — keep Allow/Deny even if pool is idle. */
    const pendingPermission =
      canvas?.id === c.id && canvas.status === "waiting_permission";
    return {
      id: c.id,
      title: c.title,
      workspace: c.workspace,
      status: pendingPermission ? "waiting_permission" : paint.status,
      live: pendingPermission ? true : paint.live,
      pendingPermission,
      /** Catalog last-activity stamp; Overview display cap sorts on this. */
      updatedAt: c.updatedAt,
    };
  });
}
