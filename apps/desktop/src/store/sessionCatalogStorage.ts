/**
 * Catalog localStorage load/save + hydrate (titles / empty-ghost prune).
 * Pure helpers except browser localStorage access.
 */

import {
  extractTitleFromTimeline,
  fallbackSessionLabel,
  isWeakSessionTitle,
  tagSeedUserMessages,
  type SessionState,
} from "@grok-desktop/acp-core";
import { migrateCatalogToCurrent } from "./sessionCatalogMigration";
import {
  NO_PROJECT_KEY,
  SESSION_STORAGE_KEY,
  type SessionRecord,
} from "./sessionCatalogTypes";

/**
 * Fix weak titles after refresh while keeping strong titles written by the agent via session_info_update.
 * When `title` is not a weak placeholder — or `titleLocked` is set — it is treated
 * as an agent- or user-confirmed display name and must not be overwritten by the first prompt.
 * @param catalog Records restored from local storage; broken fields get a displayable title from later fallbacks.
 * @returns A new array with repaired titles; does not mutate the input catalog or its records.
 */
export function rehydrateCatalogTitles(
  catalog: SessionRecord[],
): SessionRecord[] {
  return catalog.map((rec) => {
    // User-locked names stay as typed, including strings the auto-namer
    // would call weak (`Working`, `Untitled chat`).
    if (rec.titleLocked || !isWeakSessionTitle(rec.title)) {
      return rec;
    }
    const fromTl = extractTitleFromTimeline(rec.timeline ?? []);
    if (fromTl) {
      return { ...rec, title: fromTl };
    }
    return { ...rec, title: fallbackSessionLabel(rec.id) };
  });
}

/**
 * Drop empty reconnect ghosts: weak title + no messages.
 * Keeps at most one empty draft per workspace (newest).
 * @param catalog Catalog after title rehydrate.
 * @returns Pruned catalog sorted by updatedAt desc.
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
    const key = rec.workspace || NO_PROJECT_KEY;
    const prev = emptyByWs.get(key);
    if (!prev || rec.updatedAt >= prev.updatedAt) {
      emptyByWs.set(key, rec);
    }
  }

  const empties = [...emptyByWs.values()];
  return [...withContent, ...empties].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Heal titles + seed-tag for a single catalog row (hot path after upsert).
 * Does not prune empty ghosts — that remains a full-catalog concern on
 * hydrate / disk sync. Avoids O(n) walks on every live frame.
 * @param rec Catalog row after upsert / promote.
 * @returns Row with seed-tagged timeline and non-weak title when possible.
 */
export function normalizeCatalogRow(rec: SessionRecord): SessionRecord {
  const timeline = tagSeedUserMessages(rec.timeline ?? []);
  let title = rec.title;
  if (!rec.titleLocked && isWeakSessionTitle(title)) {
    const fromTl = extractTitleFromTimeline(timeline);
    title = fromTl || fallbackSessionLabel(rec.id);
  }
  if (timeline === rec.timeline && title === rec.title) {
    return rec;
  }
  return { ...rec, timeline, title };
}

/**
 * Full hydrate pipeline: seed-tag timelines, titles, then prune ghosts.
 * @param catalog Raw or partially cleaned records.
 * @returns Catalog safe to show in the rail.
 */
export function normalizeCatalog(catalog: SessionRecord[]): SessionRecord[] {
  const healed = catalog.map((rec) => ({
    ...rec,
    timeline: tagSeedUserMessages(rec.timeline ?? []),
  }));
  return pruneEmptyWeakSessions(rehydrateCatalogTitles(healed));
}

/**
 * Load catalog from localStorage (browser). SSR/Node → empty.
 * Runs v1→v2 provenance migration before title prune so untagged child
 * ghosts are hidden from the rail without deleting drill-down history.
 * @returns Normalized catalog; also rewrites storage when ghosts are pruned.
 */
export function loadCatalogFromStorage(): SessionRecord[] {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SessionRecord[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const migrated = migrateCatalogToCurrent(parsed).catalog;
    const normalized = normalizeCatalog(migrated);
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
 * @param catalog Records to serialize. Quota / private mode failures are
 *   observable via console.warn (once per failure) rather than silent swallow;
 *   eviction strategy is out of scope for this path.
 */
export function saveCatalogToStorage(catalog: SessionRecord[]): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(catalog));
  } catch (err) {
    // QuotaExceededError / private mode — surface once so operators notice.
    const name =
      err && typeof err === "object" && "name" in err
        ? String((err as { name: unknown }).name)
        : "Error";
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[session-catalog] localStorage.setItem failed (${name}): ${message}`,
    );
  }
}

/**
 * Canvas `title` restored from a catalog row.
 * Locked user names win even when they look like placeholders; otherwise a
 * non-weak stored title is treated as the agent session_info name.
 * @param rec Catalog row being projected onto the canvas.
 * @returns Title to stamp on SessionState, or undefined when none is usable.
 */
function canvasTitleFromCatalog(rec: SessionRecord): string | undefined {
  const trimmed = rec.title.trim();
  if (rec.titleLocked && trimmed) {
    return trimmed;
  }
  if (trimmed && !isWeakSessionTitle(trimmed)) {
    return rec.title;
  }
  return undefined;
}

/**
 * Convert a catalog record back into SessionState for the main pane.
 * Runs seed-user tagging so exact X+X bodies from the pre-fix resume bug
 * are collapsed before the timeline paints (handshake will re-apply the same).
 * When the session is still live in the pool, prefer pool status so the
 * composer queues instead of double-prompting a streaming process.
 * @param rec Catalog row to project onto the canvas.
 * @param poolStatus Optional live pool status for this session id.
 * @returns SessionState ready for the canvas.
 */
export function recordToSessionState(
  rec: SessionRecord,
  poolStatus?: SessionState["status"],
): SessionState {
  let status: SessionState["status"];
  if (poolStatus === "streaming" || poolStatus === "waiting_permission") {
    // Live pool process still busy — keep canvas honest so send queues.
    status = poolStatus;
  } else if (rec.status === "streaming") {
    // Stale catalog streaming without a live process → idle so send is allowed.
    status = "idle";
  } else {
    status = rec.status;
  }
  return {
    id: rec.id,
    workspace: rec.workspace,
    model: rec.model,
    mode: rec.mode,
    status,
    timeline: tagSeedUserMessages(rec.timeline ?? []),
    toolCalls: rec.toolCalls ?? {},
    plan: rec.plan,
    // Keep catalog title as agent-style title when reconnecting (session_info_update path).
    // Locked user names are always restored, even when they look like placeholders.
    title: canvasTitleFromCatalog(rec),
    lastAgentText: rec.lastAgentText ?? "",
    pendingPermission: undefined,
    // Orchestration snapshot so Agents rail survives switch/refresh.
    subagents: rec.subagents,
    subagentLinks: rec.subagentLinks,
    backgroundTasks: rec.backgroundTasks,
    goal: rec.goal,
    tokenUsage: rec.tokenUsage,
  };
}
