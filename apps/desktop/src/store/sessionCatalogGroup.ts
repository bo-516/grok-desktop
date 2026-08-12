/**
 * Catalog grouping, sort, and relative-time display helpers.
 * Pure — no React, no localStorage.
 */

import {
  NO_PROJECT_KEY,
  type ProjectGroup,
  type SessionRecord,
  type TimeBucket,
  type TimeGroup,
} from "./sessionCatalogTypes";

/**
 * Whether a row belongs to no workspace folder.
 * Either the sticky `noProject` marker (chat started with "No project", even
 * though disk filed it under the bridge cwd) or an empty workspace path.
 * @param rec Catalog session row.
 * @returns True when the row belongs in the standalone no-project section.
 */
export function isNoProjectSession(rec: SessionRecord): boolean {
  return rec.noProject === true || !rec.workspace.trim();
}

/**
 * Split rail rows into project-scoped chats and no-project chats.
 * The rail renders them as two independent sections, so the no-project list
 * never becomes a pseudo folder inside PROJECTS.
 * @param catalog Rows already filtered for the rail.
 * @returns `noProject` sorted by `updatedAt` desc; `withProject` in input order.
 */
export function splitNoProjectSessions(catalog: SessionRecord[]): {
  noProject: SessionRecord[];
  withProject: SessionRecord[];
} {
  const noProject: SessionRecord[] = [];
  const withProject: SessionRecord[] = [];
  for (const rec of catalog) {
    if (isNoProjectSession(rec)) {
      noProject.push(rec);
    } else {
      withProject.push(rec);
    }
  }
  noProject.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) {
      return b.updatedAt - a.updatedAt;
    }
    if (a.id !== b.id) {
      return a.id < b.id ? -1 : 1;
    }
    return 0;
  });
  return { noProject, withProject };
}

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
 * rows do not jump ahead of named ones. Used for project-folder order on the
 * rail (not for in-project session order, which uses `updatedAt` recency).
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
 * by last message activity (`updatedAt` desc — user or agent, not select
 * focus). Groups sort by project display name first-character ASCII.
 * User drag order / pin are applied later via rail prefs and outrank this
 * default recency order inside a project.
 * @param catalog Full session catalog.
 * @returns Project groups with sorted sessions.
 */
export function groupSessionsByProject(
  catalog: SessionRecord[],
): ProjectGroup[] {
  const map = new Map<string, SessionRecord[]>();
  for (const s of catalog) {
    const key = s.workspace || NO_PROJECT_KEY;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  const groups: ProjectGroup[] = [];
  for (const [workspace, sessions] of map) {
    const sorted = [...sessions].sort((a, b) => {
      if (b.updatedAt !== a.updatedAt) {
        return b.updatedAt - a.updatedAt;
      }
      if (a.id !== b.id) {
        return a.id < b.id ? -1 : 1;
      }
      return 0;
    });
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
 * Compact relative time for session rows.
 * Uses a short "now" window then seconds / minutes so several active chats
 * do not all read as identical "now" labels.
 * Shape: now / 45s / 12m / 1h / 1d / 3d / 1w / 2mo.
 * @param ts Event epoch ms.
 * @param now Reference now (injectable for tests).
 * @returns Short human string for the rail row.
 */
export function formatRelativeTime(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  // Keep "now" only for the freshest updates so peer rows can differ.
  if (sec < 20) {
    return "now";
  }
  if (sec < 60) {
    return `${sec}s`;
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
  // Prefer "1d" over "yesterday" so the fixed meta slot never overflows.
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
