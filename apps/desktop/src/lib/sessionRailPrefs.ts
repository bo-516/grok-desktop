/**
 * Session rail UI prefs: pin, collapse, and per-project drag order storage.
 * Pure helpers + localStorage — no React. Ordering algorithms live in
 * {@link ./sessionRailOrder} (within each workspace: pin → drag → recency
 * by last user/agent message; project folders are not reordered by pin).
 *
 * Collapse / preview-expand survive remounts via an in-memory cache that is
 * always written on save; localStorage is the cross-reload source of truth.
 * "Show more" / "Show less" mutators live in {@link ./sessionRailPreview}.
 */

/** localStorage key for pin + collapse + drag order state. */
export const SESSION_RAIL_PREFS_KEY = "grok-desktop.session-rail-prefs.v1";

export {
  applyWorkspaceSessionOrder,
  moveSessionIdInOrder,
  orderGroupsBySessionPin,
  orderSessionsByPin,
  orderSessionsByRecency,
  orderSessionsByUserThenRecency,
} from "@/lib/sessionRailOrder";

/** Persisted rail chrome for project groups, pins, and drag order. */
export type SessionRailPrefs = {
  /**
   * Pinned session ids, top-to-bottom order (index 0 = highest).
   * Stale ids are kept until the next save so a temporarily missing catalog
   * row can reappear still pinned after a re-sync.
   */
  pinnedSessions: string[];
  /**
   * Workspace paths whose session list is fully collapsed (folder-only).
   * Keys are normalized (trailing slashes stripped) so path drift does not
   * re-expand a project the user already closed.
   */
  collapsedWorkspaces: string[];
  /**
   * Workspaces where the user clicked "Show more" to reveal sessions past
   * the preview cap. Cleared by "Show less" or when that workspace is
   * collapsed. Survives remount so long lists do not re-clamp every time.
   */
  previewExpandedWorkspaces: string[];
  /**
   * Per-workspace user drag order (session ids, top-to-bottom).
   * When set for a workspace, that list outranks recency auto-sort for every
   * id it still contains; unknown / new sessions append by `updatedAt` desc.
   * Empty / missing workspace key → pure recency for that project.
   */
  sessionOrderByWorkspace: Record<string, string[]>;
};

const EMPTY_PREFS: SessionRailPrefs = {
  pinnedSessions: [],
  collapsedWorkspaces: [],
  previewExpandedWorkspaces: [],
  sessionOrderByWorkspace: {},
};

/**
 * In-process cache so remounting the rail hook never re-seeds from a cold
 * localStorage read that could lag or fail while the user already toggled
 * collapse this session. Cleared only via {@link resetSessionRailPrefsCache}
 * (tests).
 */
let memoryCache: SessionRailPrefs | null = null;

/**
 * Drop the in-memory prefs cache (test isolation only).
 * Next {@link loadSessionRailPrefs} re-reads localStorage.
 */
export function resetSessionRailPrefsCache(): void {
  memoryCache = null;
}

/**
 * Stable workspace key for collapse / preview-expand membership.
 * Strips trailing slashes; keeps "(no project)" and empty as-is.
 * @param workspace Absolute path or synthetic group key.
 * @returns Key used in collapsedWorkspaces / previewExpandedWorkspaces.
 */
export function normalizeWorkspaceKey(workspace: string): string {
  if (!workspace || workspace === "(no project)") {
    return workspace || "(no project)";
  }
  const cleaned = workspace.replace(/[/\\]+$/, "");
  return cleaned || workspace;
}

/**
 * Defensive deep-ish copy of prefs so callers cannot mutate the cache.
 * @param prefs Source prefs (already normalized or trusted).
 * @returns New object with cloned arrays/maps.
 */
function clonePrefs(prefs: SessionRailPrefs): SessionRailPrefs {
  return {
    pinnedSessions: [...prefs.pinnedSessions],
    collapsedWorkspaces: [...prefs.collapsedWorkspaces],
    previewExpandedWorkspaces: [...prefs.previewExpandedWorkspaces],
    sessionOrderByWorkspace: Object.fromEntries(
      Object.entries(prefs.sessionOrderByWorkspace).map(([k, ids]) => [
        k,
        [...ids],
      ]),
    ),
  };
}

/**
 * Empty prefs blob (fresh arrays/maps each call).
 * @returns Defaults with no pins, collapse, or drag order.
 */
function emptyPrefs(): SessionRailPrefs {
  return {
    ...EMPTY_PREFS,
    pinnedSessions: [],
    collapsedWorkspaces: [],
    previewExpandedWorkspaces: [],
    sessionOrderByWorkspace: {},
  };
}

/**
 * Normalize a prefs object from storage or partial input.
 * Accepts legacy `pinnedWorkspaces` (ignored) so old blobs still load.
 * Workspace collapse keys are re-normalized (trailing slash stripped).
 * @param raw Unknown parse result; non-arrays are treated as empty.
 * @returns Defensive copy with string-only id/path lists (deduped, order kept).
 */
export function normalizeSessionRailPrefs(raw: unknown): SessionRailPrefs {
  if (!raw || typeof raw !== "object") {
    return emptyPrefs();
  }
  const obj = raw as Record<string, unknown>;
  // Prefer the session pin list; fall back to empty when only legacy folder pins exist.
  const pinnedSessions = uniqueStrings(
    obj.pinnedSessions ?? obj.pinnedSessionIds,
  );
  return {
    pinnedSessions,
    collapsedWorkspaces: uniqueWorkspaceKeys(obj.collapsedWorkspaces),
    previewExpandedWorkspaces: uniqueWorkspaceKeys(
      obj.previewExpandedWorkspaces,
    ),
    sessionOrderByWorkspace: normalizeOrderByWorkspace(
      obj.sessionOrderByWorkspace,
    ),
  };
}

/**
 * Load rail prefs: memory cache first, else localStorage (browser).
 * SSR/Node without localStorage → empty defaults (not cached, so a later
 * browser mount can still seed from storage).
 * @returns Valid prefs; corrupt JSON falls back to empty pin/collapse lists.
 */
export function loadSessionRailPrefs(): SessionRailPrefs {
  if (memoryCache) {
    return clonePrefs(memoryCache);
  }
  if (typeof localStorage === "undefined") {
    return emptyPrefs();
  }
  try {
    const raw = localStorage.getItem(SESSION_RAIL_PREFS_KEY);
    if (!raw) {
      memoryCache = emptyPrefs();
      return clonePrefs(memoryCache);
    }
    memoryCache = normalizeSessionRailPrefs(JSON.parse(raw) as unknown);
    return clonePrefs(memoryCache);
  } catch {
    memoryCache = emptyPrefs();
    return clonePrefs(memoryCache);
  }
}

/**
 * Persist rail prefs to memory + localStorage.
 * Always updates the in-process cache so remounts see the latest collapse
 * even when localStorage write fails (quota / private mode).
 * @param prefs Latest pin + collapse lists; overwrites the previous blob.
 */
export function saveSessionRailPrefs(prefs: SessionRailPrefs): void {
  const next = normalizeSessionRailPrefs(prefs);
  memoryCache = next;
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(SESSION_RAIL_PREFS_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode — memory cache still holds the session truth
  }
}

/**
 * Whether a session id is in the pinned list.
 * @param prefs Current prefs.
 * @param sessionId Catalog session id.
 */
export function isSessionPinned(
  prefs: SessionRailPrefs,
  sessionId: string,
): boolean {
  return prefs.pinnedSessions.includes(sessionId);
}

/**
 * Whether a workspace group is collapsed (session rows hidden).
 * @param prefs Current prefs.
 * @param workspace Absolute path key (or "(no project)").
 */
export function isWorkspaceCollapsed(
  prefs: SessionRailPrefs,
  workspace: string,
): boolean {
  const key = normalizeWorkspaceKey(workspace);
  return prefs.collapsedWorkspaces.some(
    (w) => normalizeWorkspaceKey(w) === key,
  );
}

/**
 * Whether the user expanded past the session preview cap for a workspace
 * ("Show more" and not yet "Show less" / folder collapse).
 * @param prefs Current prefs.
 * @param workspace Absolute path key (or "(no project)").
 */
export function isPreviewExpanded(
  prefs: SessionRailPrefs,
  workspace: string,
): boolean {
  const key = normalizeWorkspaceKey(workspace);
  return prefs.previewExpandedWorkspaces.some(
    (w) => normalizeWorkspaceKey(w) === key,
  );
}

/**
 * Toggle pin for one session. Newly pinned is inserted at the front so it
 * appears at the top of the pinned block; unpin removes it from the list.
 * @param prefs Current prefs (not mutated).
 * @param sessionId Catalog session id.
 * @returns New prefs with pin list updated.
 */
export function togglePinnedSession(
  prefs: SessionRailPrefs,
  sessionId: string,
): SessionRailPrefs {
  if (prefs.pinnedSessions.includes(sessionId)) {
    return {
      ...prefs,
      pinnedSessions: prefs.pinnedSessions.filter((id) => id !== sessionId),
    };
  }
  return {
    ...prefs,
    pinnedSessions: [
      sessionId,
      ...prefs.pinnedSessions.filter((id) => id !== sessionId),
    ],
  };
}

/**
 * Toggle collapse for a workspace group.
 * Expanding removes the key; collapsing adds it and clears preview-expand
 * so the next open starts at the preview cap again.
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key.
 * @returns New prefs with collapse set updated.
 */
export function toggleCollapsedWorkspace(
  prefs: SessionRailPrefs,
  workspace: string,
): SessionRailPrefs {
  const key = normalizeWorkspaceKey(workspace);
  if (isWorkspaceCollapsed(prefs, key)) {
    return {
      ...prefs,
      collapsedWorkspaces: prefs.collapsedWorkspaces.filter(
        (w) => normalizeWorkspaceKey(w) !== key,
      ),
    };
  }
  return {
    ...prefs,
    collapsedWorkspaces: [
      ...prefs.collapsedWorkspaces.filter(
        (w) => normalizeWorkspaceKey(w) !== key,
      ),
      key,
    ],
    // Collapsing a folder forgets "Show more" so re-expand starts previewed.
    previewExpandedWorkspaces: prefs.previewExpandedWorkspaces.filter(
      (w) => normalizeWorkspaceKey(w) !== key,
    ),
  };
}

/**
 * Parent path for a workspace header secondary line (everything above basename).
 * @param workspace Absolute workspace path.
 * @returns Parent path string, or empty when there is no parent segment.
 */
export function workspaceParentPath(workspace: string): string {
  const cleaned = workspace.replace(/[/\\]+$/, "");
  if (!cleaned || cleaned === "(no project)") {
    return "";
  }
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }
  const isWin = /^[A-Za-z]:/.test(parts[0] ?? "");
  const parentParts = parts.slice(0, -1);
  if (cleaned.startsWith("/")) {
    return `/${parentParts.join("/")}`;
  }
  if (isWin) {
    return parentParts.join("\\");
  }
  return parentParts.join("/");
}

/**
 * Dedupe string arrays while preserving first-seen order.
 * @param value Unknown list; non-string entries dropped.
 */
function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item || seen.has(item)) {
      continue;
    }
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Dedupe workspace path keys after trailing-slash normalize.
 * @param value Unknown list; non-string entries dropped.
 * @returns Normalized workspace keys in first-seen order.
 */
function uniqueWorkspaceKeys(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item) {
      continue;
    }
    const key = normalizeWorkspaceKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Normalize the per-workspace drag-order map from storage.
 * @param value Unknown object; non-string keys / non-array values dropped.
 * @returns Defensive copy of workspace → ordered session id lists.
 */
function normalizeOrderByWorkspace(
  value: unknown,
): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(value as Record<string, unknown>)) {
    if (!key) {
      continue;
    }
    const ids = uniqueStrings(list);
    if (ids.length > 0) {
      out[key] = ids;
    }
  }
  return out;
}
