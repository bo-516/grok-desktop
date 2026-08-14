/**
 * Multi-session overview grouping (F-MULTI-01/07) — pure helpers.
 * WORKING matches footer "N running": live pool + streaming only.
 */

import type { SessionStatus } from "@grok-desktop/acp-core";

export type OverviewStatus =
  | "needs_input"
  | "working"
  | "idle"
  | "inactive"
  | "completed"
  | "failed";

/** Hard cap for the Overview list: newest `updatedAt` first, then id. */
export const OVERVIEW_SESSION_DISPLAY_LIMIT = 100;

export type OverviewSession = {
  id: string;
  title: string;
  workspace: string;
  /** Healed paint status; `streaming` only when a live pool process is busy. */
  status: SessionStatus | string;
  /** True when a resident pool process exists and is marked live. */
  live?: boolean;
  pendingPermission?: boolean;
  pinned?: boolean;
  /**
   * Last message activity (epoch ms). Overview uses this to keep only the
   * newest {@link OVERVIEW_SESSION_DISPLAY_LIMIT} rows. Missing treats as 0
   * (oldest) so a test double without activity still sorts last.
   */
  updatedAt?: number;
};

export {
  buildOverviewSessions,
  resolveOverviewPaintStatus,
  type OverviewBuildOpts,
  type OverviewPoolEntry,
} from "./multiSessionBuild";

/**
 * Map a healed Overview row into a display bucket.
 * `streaming` / `waiting_permission` require `live === true` so a raw catalog
 * leftover cannot land in WORKING / NEEDS INPUT. `pendingPermission` is the
 * focused-canvas override for Allow/Deny.
 * @param s Row after {@link resolveOverviewPaintStatus} (or a test double).
 * @returns Bucket name; unknown statuses fall through to idle.
 */
export function toOverviewStatus(s: OverviewSession): OverviewStatus {
  if (s.pendingPermission) {
    return "needs_input";
  }
  if (s.status === "waiting_permission") {
    return s.live === true ? "needs_input" : "idle";
  }
  if (s.status === "streaming") {
    return s.live === true ? "working" : "idle";
  }
  if (s.status === "disconnected") {
    return "inactive";
  }
  if (s.status === "idle") {
    return s.live === false ? "inactive" : "idle";
  }
  if (s.status === "failed" || s.status === "error") {
    return "failed";
  }
  if (s.status === "completed") {
    return "completed";
  }
  return "idle";
}

/**
 * Group sessions by overview status (stable order of buckets).
 * @param sessions Catalog + pool merged rows (already healed).
 * @returns Every bucket key present; empty arrays when nothing matches.
 */
export function groupByOverviewStatus(
  sessions: OverviewSession[],
): Record<OverviewStatus, OverviewSession[]> {
  const groups: Record<OverviewStatus, OverviewSession[]> = {
    needs_input: [],
    working: [],
    idle: [],
    inactive: [],
    completed: [],
    failed: [],
  };
  for (const s of sessions) {
    groups[toOverviewStatus(s)].push(s);
  }
  return groups;
}

/**
 * Parse overview search operators: `a:name`, `s:state`, or free text.
 * @param sessions Source rows (already filtered of subagents).
 * @param query User search string; empty returns `sessions` unchanged.
 * @returns Matching rows; `s:working` uses the healed bucket, not catalog.
 */
export function filterOverviewSessions(
  sessions: OverviewSession[],
  query: string,
): OverviewSession[] {
  const q = query.trim();
  if (!q) {
    return sessions;
  }
  const lower = q.toLowerCase();
  if (lower.startsWith("s:")) {
    const state = lower.slice(2).trim();
    return sessions.filter((s) => {
      const bucket = toOverviewStatus(s);
      return (
        bucket === state ||
        bucket.replace("_", "") === state ||
        String(s.status).toLowerCase() === state
      );
    });
  }
  if (lower.startsWith("a:")) {
    const name = lower.slice(2).trim();
    return sessions.filter((s) => s.title.toLowerCase().includes(name));
  }
  return sessions.filter(
    (s) =>
      s.title.toLowerCase().includes(lower) ||
      s.workspace.toLowerCase().includes(lower) ||
      s.id.toLowerCase().includes(lower),
  );
}

/**
 * Keep at most `limit` Overview rows, newest activity first.
 * Search still runs on the full projection; this is a display cap only.
 * @param sessions Healed rows (catalog order or already filtered). Not mutated.
 * @param limit Max rows to keep. Default {@link OVERVIEW_SESSION_DISPLAY_LIMIT}.
 *   `<= 0` returns `[]` (nothing to paint). Non-finite falls back to the default.
 * @returns New array: `updatedAt` desc, id asc on ties, then sliced. Empty in
 *   stays empty. Rows with missing `updatedAt` sort as 0 (oldest).
 */
export function limitOverviewSessions(
  sessions: OverviewSession[],
  limit: number = OVERVIEW_SESSION_DISPLAY_LIMIT,
): OverviewSession[] {
  /** Effective cap; NaN / Infinity must not become `slice` garbage. */
  const cap =
    typeof limit === "number" && Number.isFinite(limit)
      ? Math.floor(limit)
      : OVERVIEW_SESSION_DISPLAY_LIMIT;
  if (cap <= 0 || sessions.length === 0) {
    return [];
  }
  /** Recency copy so the caller can still hold the untrimmed projection. */
  const ordered = [...sessions].sort((a, b) => {
    /** Missing activity sorts as oldest so live rows with stamps win. */
    const aAt = a.updatedAt ?? 0;
    const bAt = b.updatedAt ?? 0;
    if (bAt !== aAt) {
      return bAt - aAt;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
  if (ordered.length <= cap) {
    return ordered;
  }
  return ordered.slice(0, cap);
}
