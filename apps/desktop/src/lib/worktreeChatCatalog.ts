/**
 * Catalog and localStorage side of worktree chats.
 * Stamps pool identities onto rows and remembers source repos so a cold
 * start still groups a worktree under its project. Storage failures are
 * ignored; the in-memory copies still work for this page load.
 */

import type { SessionRecord } from "@/store/sessionCatalogTypes";
import {
  canonicalProjectPath,
  parseWorkspaceGit,
  type WorktreeChatDefault,
  type WorktreeInfo,
  type WorktreeSourceCacheEntry,
} from "./worktreeChat";

/** localStorage map of project path → new-chat worktree default. */
const DEFAULTS_KEY = "grok-desktop.worktree-chat-defaults.v1";
/** localStorage map of checkout path → source repo (or a negative probe). */
const SOURCE_CACHE_KEY = "grok-desktop.worktree-source.v1";

/**
 * Copy pool worktree info onto matching catalog rows.
 * Entries without a path and source repo are ignored, so a normal session
 * cannot wipe a badge. Rows that already match are kept by reference.
 * Also writes the source cache so a later cold start can group the row
 * before the pool speaks.
 * @param catalog Current catalog. Not mutated.
 * @param entries Pool summaries. Only `sessionId` and `worktree` are read.
 * @returns The same array when nothing changed, otherwise a new array.
 */
export function stampCatalogWorktrees(
  catalog: SessionRecord[],
  entries: ReadonlyArray<{ sessionId: string; worktree?: WorktreeInfo | null }>,
): SessionRecord[] {
  const byId = new Map<string, WorktreeInfo>();
  for (const entry of entries) {
    const info = normalizeWorktreeInfo(entry.worktree);
    if (!info) {
      continue;
    }
    byId.set(entry.sessionId, info);
    rememberWorktreeInfo(info);
  }
  if (byId.size === 0) {
    return catalog;
  }
  let changed = false;
  const next = catalog.map((rec) => {
    const info = byId.get(rec.id);
    if (!info || sameWorktree(rec.worktree, info)) {
      return rec;
    }
    changed = true;
    return { ...rec, worktree: info };
  });
  return changed ? next : catalog;
}

/**
 * Overlay cached source repos onto rows that do not already carry one.
 * A negative cache entry leaves the row grouped by its own workspace.
 * @param catalog Rows to group. Not mutated.
 * @param cache Probe memory keyed by {@link canonicalProjectPath}.
 * @returns The same array when no row gained a source, otherwise copies.
 */
export function overlayWorktreeSources(
  catalog: SessionRecord[],
  cache: Readonly<Record<string, WorktreeSourceCacheEntry>>,
): SessionRecord[] {
  let changed = false;
  const next = catalog.map((rec) => {
    if (rec.worktree?.sourceRepo) {
      return rec;
    }
    const hit = cache[canonicalProjectPath(rec.workspace)];
    if (!hit?.sourceRepo) {
      return rec;
    }
    if (
      canonicalProjectPath(hit.sourceRepo) ===
      canonicalProjectPath(rec.workspace)
    ) {
      return rec;
    }
    changed = true;
    return {
      ...rec,
      worktree: {
        path: hit.path || rec.workspace,
        branch: hit.branch || "",
        sourceRepo: hit.sourceRepo,
        name: hit.name,
        id: hit.id,
      },
    };
  });
  return changed ? next : catalog;
}

/**
 * Turn one `workspace_git` envelope into a cache entry.
 * Failure, a non-repo, or a checkout that is its own source is negative
 * so the rail does not probe that path again.
 * @param path Directory that was probed.
 * @param result CLI envelope. `ok: false` is a negative cache entry.
 * @returns Entry to store under the canonical path.
 */
export function sourceCacheFromProbe(
  path: string,
  result: { ok: boolean; data?: unknown },
): WorktreeSourceCacheEntry {
  const git = result.ok ? parseWorkspaceGit(result.data) : null;
  if (!git?.isRepo || !git.worktree || !git.sourceRepo) {
    return { sourceRepo: null };
  }
  if (canonicalProjectPath(git.sourceRepo) === canonicalProjectPath(path)) {
    return { sourceRepo: null };
  }
  return {
    sourceRepo: git.sourceRepo,
    branch: git.branch,
    name: git.worktreeName,
    id: git.worktreeId,
    path: git.worktreePath || path,
  };
}

/**
 * Load the per-project default. A missing key or broken storage is null
 * (the checkbox starts off). A stored object with a non-boolean `enabled`
 * is null so a corrupt value cannot force worktrees on.
 * @param projectKey {@link projectPrefsKey} of the selected project.
 * @returns Saved default, or null when absent or unreadable.
 */
export function loadWorktreeChatDefault(
  projectKey: string,
): WorktreeChatDefault | null {
  if (!projectKey) {
    return null;
  }
  const all = readJson(DEFAULTS_KEY);
  if (!all || typeof all !== "object") {
    return null;
  }
  const raw = (all as Record<string, unknown>)[projectKey];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") {
    return null;
  }
  return {
    enabled: row.enabled,
    name: typeof row.name === "string" ? row.name : "",
    ref: typeof row.ref === "string" ? row.ref : "",
  };
}

/**
 * Remember the checkbox for one project. Storage failures are ignored
 * (private mode); the in-memory widget state still applies to this send.
 * @param projectKey {@link projectPrefsKey}. Blank is a no-op.
 * @param value Fields to store. Empty strings are kept so a cleared name
 * stays cleared on the next new chat.
 */
export function saveWorktreeChatDefault(
  projectKey: string,
  value: WorktreeChatDefault,
): void {
  if (!projectKey) {
    return;
  }
  const all = readJson(DEFAULTS_KEY);
  const next =
    all && typeof all === "object" ? { ...(all as Record<string, unknown>) } : {};
  next[projectKey] = value;
  writeJson(DEFAULTS_KEY, next);
}

/**
 * Load the path → source cache. Unreadable storage yields an empty map,
 * which makes the rail probe again instead of grouping on stale junk.
 * @returns Cache. Never null.
 */
export function loadWorktreeSourceCache(): Record<string, WorktreeSourceCacheEntry> {
  const raw = readJson(SOURCE_CACHE_KEY);
  if (!raw || typeof raw !== "object") {
    return {};
  }
  return raw as Record<string, WorktreeSourceCacheEntry>;
}

/**
 * Replace the source cache. Used after a probe batch. Storage failures
 * leave the in-memory copy the hook already holds.
 * @param cache Full map, including negative entries.
 */
export function saveWorktreeSourceCache(
  cache: Record<string, WorktreeSourceCacheEntry>,
): void {
  writeJson(SOURCE_CACHE_KEY, cache);
}

/**
 * True when the cache already answered this checkout (positive or negative).
 * @param cache Current cache.
 * @param path Session workspace.
 * @returns True when a probe would repeat a known answer.
 */
export function sourceCacheHas(
  cache: Readonly<Record<string, WorktreeSourceCacheEntry>>,
  path: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(cache, canonicalProjectPath(path));
}

/**
 * Remember a pool identity under the worktree path.
 * The source repo is the stored value, not a second key — keying the
 * source itself would regroup the main checkout as a worktree. Negative
 * entries are not written here; a later probe can still fill gaps.
 * @param info Identity with a non-empty path and source repo.
 */
function rememberWorktreeInfo(info: WorktreeInfo): void {
  const cache = loadWorktreeSourceCache();
  const entry: WorktreeSourceCacheEntry = {
    sourceRepo: info.sourceRepo,
    branch: info.branch,
    name: info.name,
    id: info.id,
    path: info.path,
  };
  cache[canonicalProjectPath(info.path)] = entry;
  saveWorktreeSourceCache(cache);
}

/**
 * Accept a pool worktree only when path and source repo are non-empty
 * strings. Anything else is ignored so a partial frame cannot badge a row.
 * @param raw Pool field. Null and undefined are ignored.
 * @returns A copy, or null when the identity is incomplete.
 */
function normalizeWorktreeInfo(
  raw: WorktreeInfo | null | undefined,
): WorktreeInfo | null {
  if (!raw || typeof raw.path !== "string" || typeof raw.sourceRepo !== "string") {
    return null;
  }
  const path = raw.path.trim();
  const sourceRepo = raw.sourceRepo.trim();
  if (!path || !sourceRepo) {
    return null;
  }
  return {
    path,
    branch: typeof raw.branch === "string" ? raw.branch : "",
    sourceRepo,
    name: raw.name?.trim() || undefined,
    id: raw.id?.trim() || undefined,
  };
}

/**
 * Field-wise equality so a repeated pool frame does not clone the row.
 * @param left Catalog value. Undefined does not equal a real info.
 * @param right Normalized pool info.
 * @returns True when stamping would not change the row.
 */
function sameWorktree(
  left: WorktreeInfo | undefined,
  right: WorktreeInfo,
): boolean {
  if (!left) {
    return false;
  }
  return (
    left.path === right.path &&
    left.branch === right.branch &&
    left.sourceRepo === right.sourceRepo &&
    (left.name ?? "") === (right.name ?? "") &&
    (left.id ?? "") === (right.id ?? "")
  );
}

/**
 * Read one JSON localStorage value. Missing storage, a thrown access
 * (private mode), or invalid JSON yields null.
 * @param key Storage key.
 * @returns Parsed value, or null.
 */
function readJson(key: string): unknown {
  const store = browserStorage();
  if (!store) {
    return null;
  }
  try {
    const text = store.getItem(key);
    if (!text) {
      return null;
    }
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Write one JSON value. Failures are ignored.
 * @param key Storage key.
 * @param value JSON-serializable value.
 */
function writeJson(key: string, value: unknown): void {
  const store = browserStorage();
  if (!store) {
    return;
  }
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the in-memory copy still works.
  }
}

/**
 * localStorage when this page has it. Node tests and private mode get null.
 * @returns The storage object, or null.
 */
function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}
