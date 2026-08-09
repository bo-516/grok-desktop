/**
 * Multi-session overview grouping (F-MULTI-01/07) — pure helpers.
 */

import type { SessionStatus } from "@grok-desktop/acp-core";

export type OverviewStatus =
  | "needs_input"
  | "working"
  | "idle"
  | "inactive"
  | "completed"
  | "failed";

export type OverviewSession = {
  id: string;
  title: string;
  workspace: string;
  status: SessionStatus | string;
  live?: boolean;
  pendingPermission?: boolean;
  pinned?: boolean;
};

/**
 * Map pool/session status into overview buckets.
 * @param s Session row.
 */
export function toOverviewStatus(s: OverviewSession): OverviewStatus {
  if (s.pendingPermission || s.status === "waiting_permission") {
    return "needs_input";
  }
  if (s.status === "streaming") {
    return "working";
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
 * @param sessions Catalog + pool merged rows.
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
 * @param query User search string.
 * @param sessions Source rows.
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
