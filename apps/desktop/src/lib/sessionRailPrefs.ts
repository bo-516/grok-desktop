/**
 * Session rail UI prefs: pin, collapse, and per-project drag order storage.
 * Pure helpers + localStorage — no React. Ordering algorithms live in
 * {@link ./sessionRailOrder} (within each workspace: pin → drag → title
 * first-char auto-sort; project folders are not reordered by pin).
 */

/** localStorage key for pin + collapse + drag order state. */
export const SESSION_RAIL_PREFS_KEY = "grok-desktop.session-rail-prefs.v1";

export {
  applyWorkspaceSessionOrder,
  moveSessionIdInOrder,
  orderGroupsBySessionPin,
  orderSessionsByPin,
  orderSessionsByTitleAscii,
  orderSessionsByUserThenAscii,
} from "@/lib/sessionRailOrder";

/** Persisted rail chrome for project groups, pins, and drag order. */
export type SessionRailPrefs = {
  /**
   * Pinned session ids, top-to-bottom order (index 0 = highest).
   * Stale ids are kept until the next save so a temporarily missing catalog
   * row can reappear still pinned after a re-sync.
   */
  pinnedSessions: string[];
  /** Workspace paths whose session list is collapsed. */
  collapsedWorkspaces: string[];
  /**
   * Per-workspace user drag order (session ids, top-to-bottom).
   * When set for a workspace, that list outranks title auto-sort for every
   * id it still contains; unknown / new sessions append by title ASCII.
   * Empty / missing workspace key → pure auto-sort for that project.
   */
  sessionOrderByWorkspace: Record<string, string[]>;
};

const EMPTY_PREFS: SessionRailPrefs = {
  pinnedSessions: [],
  collapsedWorkspaces: [],
  sessionOrderByWorkspace: {},
};

/**
 * Normalize a prefs object from storage or partial input.
 * Accepts legacy `pinnedWorkspaces` (ignored) so old blobs still load.
 * @param raw Unknown parse result; non-arrays are treated as empty.
 * @returns Defensive copy with string-only id/path lists (deduped, order kept).
 */
export function normalizeSessionRailPrefs(raw: unknown): SessionRailPrefs {
  if (!raw || typeof raw !== "object") {
    return {
      ...EMPTY_PREFS,
      pinnedSessions: [],
      collapsedWorkspaces: [],
      sessionOrderByWorkspace: {},
    };
  }
  const obj = raw as Record<string, unknown>;
  // Prefer the session pin list; fall back to empty when only legacy folder pins exist.
  const pinnedSessions = uniqueStrings(
    obj.pinnedSessions ?? obj.pinnedSessionIds,
  );
  return {
    pinnedSessions,
    collapsedWorkspaces: uniqueStrings(obj.collapsedWorkspaces),
    sessionOrderByWorkspace: normalizeOrderByWorkspace(
      obj.sessionOrderByWorkspace,
    ),
  };
}

/**
 * Load rail prefs from localStorage (browser). SSR/Node → empty defaults.
 * @returns Valid prefs; corrupt JSON falls back to empty pin/collapse lists.
 */
export function loadSessionRailPrefs(): SessionRailPrefs {
  if (typeof localStorage === "undefined") {
    return {
      ...EMPTY_PREFS,
      pinnedSessions: [],
      collapsedWorkspaces: [],
      sessionOrderByWorkspace: {},
    };
  }
  try {
    const raw = localStorage.getItem(SESSION_RAIL_PREFS_KEY);
    if (!raw) {
      return {
        ...EMPTY_PREFS,
        pinnedSessions: [],
        collapsedWorkspaces: [],
        sessionOrderByWorkspace: {},
      };
    }
    return normalizeSessionRailPrefs(JSON.parse(raw) as unknown);
  } catch {
    return {
      ...EMPTY_PREFS,
      pinnedSessions: [],
      collapsedWorkspaces: [],
      sessionOrderByWorkspace: {},
    };
  }
}

/**
 * Persist rail prefs to localStorage.
 * @param prefs Latest pin + collapse lists; overwrites the previous blob.
 */
export function saveSessionRailPrefs(prefs: SessionRailPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      SESSION_RAIL_PREFS_KEY,
      JSON.stringify(normalizeSessionRailPrefs(prefs)),
    );
  } catch {
    // quota / private mode — ignore
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
  return prefs.collapsedWorkspaces.includes(workspace);
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
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key.
 * @returns New prefs with collapse set updated.
 */
export function toggleCollapsedWorkspace(
  prefs: SessionRailPrefs,
  workspace: string,
): SessionRailPrefs {
  if (prefs.collapsedWorkspaces.includes(workspace)) {
    return {
      ...prefs,
      collapsedWorkspaces: prefs.collapsedWorkspaces.filter(
        (w) => w !== workspace,
      ),
    };
  }
  return {
    ...prefs,
    collapsedWorkspaces: [...prefs.collapsedWorkspaces, workspace],
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
