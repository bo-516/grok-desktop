/**
 * Session catalog: persist + group by project (Codex-style mission control).
 * Pure helpers — no React. Storage is localStorage in the browser.
 */

import {
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isWeakSessionTitle,
  pickSessionTitle,
  tagSeedUserMessages,
  titleFromSessionState,
  type AgentMode,
  type PlanEntry,
  type SessionState,
  type SessionStatus,
  type TimelineItem,
  type ToolCallCard,
} from "@grok-desktop/acp-core";

/** One remembered conversation (live or historical cache). */
export type SessionRecord = {
  id: string;
  /** Absolute workspace path used as project key. */
  workspace: string;
  /** Display title (first user prompt or fallback). */
  title: string;
  mode: AgentMode;
  model: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard>;
  plan?: PlanEntry[];
  lastAgentText: string;
};

export type ProjectGroup = {
  /** Grouping key = workspace path. */
  workspace: string;
  /** Basename for header. */
  projectName: string;
  sessions: SessionRecord[];
};

export const SESSION_STORAGE_KEY = "grok-desktop.session-catalog.v1";

export {
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isWeakSessionTitle,
  pickSessionTitle,
  titleFromSessionState,
};

/**
 * Project display name from workspace path (Codex-style group header).
 */
export function projectNameFromWorkspace(workspace: string): string {
  const cleaned = workspace.replace(/[/\\]+$/, "");
  if (!cleaned) {return "(unknown project)";}
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

/**
 * Merge live ACP state into a catalog record (upsert by session id).
 * Preserves good titles; never replaces them with Session/Chat id labels.
 */
export function upsertFromLiveState(
  catalog: SessionRecord[],
  state: SessionState,
  now = Date.now(),
): SessionRecord[] {
  if (!state.id) {return catalog;}
  const existing = catalog.find((s) => s.id === state.id);
  // Prefer longer timeline (avoid empty handshake clobbering a rich cache)
  const useIncomingTimeline =
    !existing ||
    state.timeline.length >= existing.timeline.length ||
    state.timeline.length > 0 && existing.timeline.length === 0;

  /** Merge timeline: use inbound when useIncoming; otherwise existing is guaranteed (see conditions above). */
  let timeline = state.timeline;
  if (!useIncomingTimeline && existing) {
    timeline = existing.timeline;
  }
  // Heal pre-fix exact X+X user bodies whenever we persist a catalog row.
  timeline = tagSeedUserMessages(timeline);
  /** Merge toolCalls: prefer full inbound, else non-empty inbound patch, else fall back to cached. */
  let toolCalls = state.toolCalls;
  if (!useIncomingTimeline) {
    if (Object.keys(state.toolCalls).length > 0) {
      toolCalls = state.toolCalls;
    } else if (existing) {
      toolCalls = existing.toolCalls;
    }
  }
  const plan =
    state.plan && state.plan.length > 0
      ? state.plan
      : existing?.plan;

  const mergedState: SessionState = {
    ...state,
    timeline,
    toolCalls,
    plan,
    lastAgentText: state.lastAgentText || existing?.lastAgentText || "",
  };

  const next: SessionRecord = {
    id: state.id,
    workspace: state.workspace || existing?.workspace || "",
    title: pickSessionTitle({
      state: mergedState,
      existingTitle: existing?.title,
    }),
    mode: state.mode || existing?.mode || "build",
    model: state.model || existing?.model || "",
    status: state.status,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    timeline,
    toolCalls,
    plan,
    lastAgentText: mergedState.lastAgentText,
  };
  const without = catalog.filter((s) => s.id !== state.id);
  return [next, ...without].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Fix weak titles after refresh while keeping strong titles written by the agent via session_info_update.
 * When `title` is not a weak placeholder it is treated as an agent- or user-confirmed display name
 * and must not be overwritten by the first prompt.
 * @param catalog Records restored from local storage; broken fields get a displayable title from later fallbacks.
 * @returns A new array with repaired titles; does not mutate the input catalog or its records.
 */
export function rehydrateCatalogTitles(
  catalog: SessionRecord[],
): SessionRecord[] {
  return catalog.map((rec) => {
    if (!isWeakSessionTitle(rec.title)) {return rec;}
    const fromTl = extractTitleFromTimeline(rec.timeline ?? []);
    if (fromTl) {return { ...rec, title: fromTl };}
    return { ...rec, title: fallbackSessionLabel(rec.id) };
  });
}

/**
 * Drop empty reconnect ghosts: weak title + no messages.
 * Keeps at most one empty draft per workspace (newest).
 */
export function pruneEmptyWeakSessions(
  catalog: SessionRecord[],
): SessionRecord[] {
  const withContent: SessionRecord[] = [];
  const emptyByWs = new Map<string, SessionRecord>();

  for (const rec of catalog) {
    const hasMsgs = (rec.timeline?.length ?? 0) > 0;
    const weak = isWeakSessionTitle(rec.title);
    if (hasMsgs || !weak) {
      withContent.push(rec);
      continue;
    }
    // empty + weak title → keep only newest per workspace
    const key = rec.workspace || "(no project)";
    const prev = emptyByWs.get(key);
    if (!prev || rec.updatedAt >= prev.updatedAt) {
      emptyByWs.set(key, rec);
    }
  }

  const empties = [...emptyByWs.values()];
  return [...withContent, ...empties].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Full hydrate pipeline: titles then prune ghosts. */
export function normalizeCatalog(catalog: SessionRecord[]): SessionRecord[] {
  const healed = catalog.map((rec) => ({
    ...rec,
    timeline: tagSeedUserMessages(rec.timeline ?? []),
  }));
  return pruneEmptyWeakSessions(rehydrateCatalogTitles(healed));
}

/**
 * Group sessions by workspace path; each group sorted by updatedAt desc.
 * Groups ordered by most recent session activity (Codex multi-project sidebar).
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
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    groups.push({
      workspace,
      projectName: projectNameFromWorkspace(workspace),
      sessions: sorted,
    });
  }
  groups.sort((a, b) => {
    const aT = a.sessions[0]?.updatedAt ?? 0;
    const bT = b.sessions[0]?.updatedAt ?? 0;
    return bT - aT;
  });
  return groups;
}

/** Time-bucket label used by the Framer side-nav (Today / Yesterday / Earlier). */
export type TimeBucket = "today" | "yesterday" | "earlier";

/** One time-bucket group for the session rail. */
export type TimeGroup = {
  /** Bucket key. */
  bucket: TimeBucket;
  /** Display label (en-US). */
  label: string;
  /** Sessions in this bucket, newest first. */
  sessions: SessionRecord[];
};

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
 * Load catalog from localStorage (browser). SSR/Node → empty.
 */
export function loadCatalogFromStorage(): SessionRecord[] {
  if (typeof localStorage === "undefined") {return [];}
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {return [];}
    const parsed = JSON.parse(raw) as SessionRecord[];
    if (!Array.isArray(parsed)) {return [];}
    const normalized = normalizeCatalog(parsed);
    // Persist cleaned catalog so ghost sessions disappear after refresh.
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      /* ignore */
    }
    return normalized;
  } catch {
    return [];
  }
}

/**
 * Persist catalog to localStorage.
 */
export function saveCatalogToStorage(catalog: SessionRecord[]): void {
  if (typeof localStorage === "undefined") {return;}
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // quota / private mode — ignore
  }
}

/**
 * Compact relative time for session rows (Framer: now / 12m / 1h / yesterday / 3d / 1w).
 * @param ts Event epoch ms.
 * @param now Reference now (injectable for tests).
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

/**
 * Convert a catalog record back into SessionState for the main pane.
 * Runs seed-user tagging so exact X+X bodies from the pre-fix resume bug
 * are collapsed before the timeline paints (handshake will re-apply the same).
 */
export function recordToSessionState(rec: SessionRecord): SessionState {
  return {
    id: rec.id,
    workspace: rec.workspace,
    model: rec.model,
    mode: rec.mode,
    status: rec.status === "streaming" ? "idle" : rec.status,
    timeline: tagSeedUserMessages(rec.timeline ?? []),
    toolCalls: rec.toolCalls ?? {},
    plan: rec.plan,
    // Keep catalog title as agent-style title when reconnecting (session_info_update path).
    title:
      rec.title && !isWeakSessionTitle(rec.title) ? rec.title : undefined,
    lastAgentText: rec.lastAgentText ?? "",
    pendingPermission: undefined,
  };
}
