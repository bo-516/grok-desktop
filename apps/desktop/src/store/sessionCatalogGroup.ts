/**
 * Catalog grouping, sort, and relative-time display helpers.
 * Pure — no React, no localStorage.
 */

import type {
  ProjectGroup,
  SessionRecord,
  TimeBucket,
  TimeGroup,
} from "./sessionCatalogTypes";

/**
 * Project display name from workspace path (Codex-style group header).
 * @param workspace Absolute path or empty; trailing slashes are stripped.
 * @returns Basename, or "(unknown project)" when empty.
 */
export function projectNameFromWorkspace(workspace: string): string {
  const cleaned = workspace.replace(/[/\\]+$/, "");
  if (!cleaned) {
    return "(unknown project)";
  }
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

/**
 * Compare display labels by first-character code unit (ascending), then full
 * string, then a stable id when provided. Empty labels sort last so untitled
 * rows do not jump ahead of named ones. Used for rail auto-order: select /
 * recency must not reshuffle the list.
 * @param aLabel Left title or project name.
 * @param bLabel Right title or project name.
 * @param aId Optional stable tiebreaker (session id / workspace path).
 * @param bId Optional stable tiebreaker for the right side.
 * @returns Negative when a should come before b.
 */
export function compareByFirstCharAscii(
  aLabel: string,
  bLabel: string,
  aId = "",
  bId = "",
): number {
  const aCode =
    aLabel.length > 0 ? aLabel.charCodeAt(0) : Number.POSITIVE_INFINITY;
  const bCode =
    bLabel.length > 0 ? bLabel.charCodeAt(0) : Number.POSITIVE_INFINITY;
  if (aCode !== bCode) {
    return aCode - bCode;
  }
  if (aLabel !== bLabel) {
    return aLabel < bLabel ? -1 : 1;
  }
  if (aId !== bId) {
    return aId < bId ? -1 : 1;
  }
  return 0;
}

/**
 * Group sessions by workspace folder path. Within each group, sessions sort
 * by title first-character code unit (asc). Groups sort by project display
 * name the same way. Select / message recency never changes this order;
 * user drag order is applied later via rail prefs.
 * @param catalog Full session catalog.
 * @returns Project groups with sorted sessions.
 */
export function groupSessionsByProject(
  catalog: SessionRecord[],
): ProjectGroup[] {
  const map = new Map<string, SessionRecord[]>();
  for (const s of catalog) {
    const key = s.workspace || "(no project)";
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  const groups: ProjectGroup[] = [];
  for (const [workspace, sessions] of map) {
    const sorted = [...sessions].sort((a, b) =>
      compareByFirstCharAscii(a.title, b.title, a.id, b.id),
    );
    groups.push({
      workspace,
      projectName: projectNameFromWorkspace(workspace),
      sessions: sorted,
    });
  }
  groups.sort((a, b) =>
    compareByFirstCharAscii(
      a.projectName,
      b.projectName,
      a.workspace,
      b.workspace,
    ),
  );
  return groups;
}

/**
 * Start of local calendar day for a timestamp.
 * @param ts Epoch ms.
 * @returns Midnight local time as epoch ms.
 */
function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Map a session timestamp into Today / Yesterday / Earlier.
 * @param updatedAt Session updatedAt epoch ms.
 * @param now Reference now (injectable for tests).
 * @returns Bucket key for rail sections.
 */
export function timeBucketFor(
  updatedAt: number,
  now = Date.now(),
): TimeBucket {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  if (updatedAt >= todayStart) {
    return "today";
  }
  if (updatedAt >= yesterdayStart) {
    return "yesterday";
  }
  return "earlier";
}

const TIME_BUCKET_ORDER: TimeBucket[] = ["today", "yesterday", "earlier"];
const TIME_BUCKET_LABEL: Record<TimeBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
};

/**
 * Group sessions by recency buckets (Framer prototype side-nav).
 * Empty buckets are omitted. Sessions within a bucket sorted by updatedAt desc.
 * @param catalog Full session catalog.
 * @param now Reference now (injectable for tests).
 * @returns Non-empty time groups in Today → Earlier order.
 */
export function groupSessionsByTime(
  catalog: SessionRecord[],
  now = Date.now(),
): TimeGroup[] {
  const map = new Map<TimeBucket, SessionRecord[]>();
  for (const bucket of TIME_BUCKET_ORDER) {
    map.set(bucket, []);
  }
  for (const s of catalog) {
    const bucket = timeBucketFor(s.updatedAt, now);
    map.get(bucket)?.push(s);
  }
  const groups: TimeGroup[] = [];
  for (const bucket of TIME_BUCKET_ORDER) {
    const sessions = map.get(bucket) ?? [];
    if (sessions.length === 0) {
      continue;
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    groups.push({
      bucket,
      label: TIME_BUCKET_LABEL[bucket],
      sessions,
    });
  }
  return groups;
}

/**
 * Compact relative time for session rows (Framer: now / 12m / 1h / yesterday / 3d / 1w).
 * @param ts Event epoch ms.
 * @param now Reference now (injectable for tests).
 * @returns Short human string for the rail row.
 */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 60) {
    return "now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return `${hr}h`;
  }
  const day = Math.floor(hr / 24);
  if (day === 1) {
    return "yesterday";
  }
  if (day < 7) {
    return `${day}d`;
  }
  const week = Math.floor(day / 7);
  if (week < 5) {
    return `${week}w`;
  }
  const month = Math.floor(day / 30);
  return `${Math.max(1, month)}mo`;
}
