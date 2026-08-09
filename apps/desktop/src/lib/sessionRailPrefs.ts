/**
 * Session rail UI prefs: which workspace groups are pinned / collapsed.
 * Pure helpers + localStorage — no React. Pin order is user-controlled;
 * collapse is a set of workspace path keys.
 */

import type { ProjectGroup } from "@/store/sessionCatalog";

/** localStorage key for pin + collapse state. */
export const SESSION_RAIL_PREFS_KEY = "grok-desktop.session-rail-prefs.v1";

/** Persisted rail chrome for workspace project groups. */
export type SessionRailPrefs = {
  /**
   * Pinned workspace paths, top-to-bottom order (index 0 = highest).
   * Only known catalog workspaces are applied; stale paths are kept until
   * the next save so temporarily empty projects stay pinned after prune.
   */
  pinnedWorkspaces: string[];
  /** Workspace paths whose session list is collapsed. */
  collapsedWorkspaces: string[];
};

const EMPTY_PREFS: SessionRailPrefs = {
  pinnedWorkspaces: [],
  collapsedWorkspaces: [],
};

/**
 * Normalize a prefs object from storage or partial input.
 * @param raw Unknown parse result; non-arrays are treated as empty.
 * @returns Defensive copy with string-only path lists (deduped, order kept).
 */
export function normalizeSessionRailPrefs(raw: unknown): SessionRailPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_PREFS, pinnedWorkspaces: [], collapsedWorkspaces: [] };
  }
  const obj = raw as Record<string, unknown>;
  return {
    pinnedWorkspaces: uniqueStrings(obj.pinnedWorkspaces),
    collapsedWorkspaces: uniqueStrings(obj.collapsedWorkspaces),
  };
}

/**
 * Load rail prefs from localStorage (browser). SSR/Node → empty defaults.
 * @returns Valid prefs; corrupt JSON falls back to empty pin/collapse lists.
 */
export function loadSessionRailPrefs(): SessionRailPrefs {
  if (typeof localStorage === "undefined") {
    return { ...EMPTY_PREFS, pinnedWorkspaces: [], collapsedWorkspaces: [] };
  }
  try {
    const raw = localStorage.getItem(SESSION_RAIL_PREFS_KEY);
    if (!raw) {
      return { ...EMPTY_PREFS, pinnedWorkspaces: [], collapsedWorkspaces: [] };
    }
    return normalizeSessionRailPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...EMPTY_PREFS, pinnedWorkspaces: [], collapsedWorkspaces: [] };
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
 * Whether a workspace path is in the pinned list.
 * @param prefs Current prefs.
 * @param workspace Absolute path key (or "(no project)").
 */
export function isWorkspacePinned(
  prefs: SessionRailPrefs,
  workspace: string,
): boolean {
  return prefs.pinnedWorkspaces.includes(workspace);
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
 * Toggle pin for a workspace. Newly pinned is inserted at the front so it
 * appears at the top of the pinned block; unpin removes it from the list.
 * @param prefs Current prefs (not mutated).
 * @param workspace Workspace path key.
 * @returns New prefs with pin list updated.
 */
export function togglePinnedWorkspace(
  prefs: SessionRailPrefs,
  workspace: string,
): SessionRailPrefs {
  if (prefs.pinnedWorkspaces.includes(workspace)) {
    return {
      ...prefs,
      pinnedWorkspaces: prefs.pinnedWorkspaces.filter((w) => w !== workspace),
    };
  }
  return {
    ...prefs,
    pinnedWorkspaces: [workspace, ...prefs.pinnedWorkspaces.filter((w) => w !== workspace)],
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
 * Order project groups: pinned workspaces first (prefs pin order), then the
 * remaining groups in their original recency order.
 * @param groups Groups already sorted by last-message recency.
 * @param pinnedWorkspaces Pin order from prefs (index 0 highest).
 * @returns New array; does not mutate `groups`.
 */
export function orderGroupsByPin(
  groups: ProjectGroup[],
  pinnedWorkspaces: string[],
): ProjectGroup[] {
  if (pinnedWorkspaces.length === 0 || groups.length === 0) {
    return groups;
  }
  const byWs = new Map(groups.map((g) => [g.workspace, g]));
  const pinned: ProjectGroup[] = [];
  for (const ws of pinnedWorkspaces) {
    const g = byWs.get(ws);
    if (g) {
      pinned.push(g);
      byWs.delete(ws);
    }
  }
  const rest = groups.filter((g) => byWs.has(g.workspace));
  return [...pinned, ...rest];
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
