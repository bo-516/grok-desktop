/**
 * Active / known workspace (project) prefs for the rail project switcher.
 * Pure helpers + localStorage — no React. Catalog workspaces are merged at
 * list time; this store only keeps the user's default cwd and explicitly
 * created projects that may not have sessions yet.
 */

/** localStorage key for active + known workspace paths. */
export const WORKSPACE_PREFS_KEY = "grok-desktop.workspace-prefs.v1";

/** Persisted default project selection for New chat / empty-session switch. */
export type WorkspacePrefs = {
  /**
   * Default workspace absolute path when {@link noProject} is false.
   * Empty string alone is not enough — bridge may still report a cwd; use
   * {@link noProject} so the UI stays on "No project".
   */
  activeWorkspace: string;
  /**
   * Paths the user added via Create project (may not appear in the catalog yet).
   * Order is first-seen; list UI may re-sort for display.
   */
  knownWorkspaces: string[];
  /**
   * User chose "Work without a project". When true, New chat / display must
   * not fall back to bridge default cwd or a non-empty session.workspace.
   */
  noProject: boolean;
};

const EMPTY: WorkspacePrefs = {
  activeWorkspace: "",
  knownWorkspaces: [],
  noProject: false,
};

/**
 * Normalize a prefs blob from storage or partial input.
 * @param raw Unknown parse result.
 * @returns Defensive copy with string-only paths (deduped).
 */
export function normalizeWorkspacePrefs(raw: unknown): WorkspacePrefs {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY, knownWorkspaces: [] };
  }
  const obj = raw as Record<string, unknown>;
  const active =
    typeof obj.activeWorkspace === "string" ? obj.activeWorkspace.trim() : "";
  // Prefer explicit flag; never invent noProject from empty active alone
  // (first-run empty means "unset", not "user chose no project").
  const noProject = obj.noProject === true && !active;
  return {
    activeWorkspace: active,
    knownWorkspaces: uniquePaths(obj.knownWorkspaces),
    noProject,
  };
}

/**
 * Load workspace prefs from localStorage (browser). SSR/Node → empty defaults.
 * @returns Valid prefs; corrupt JSON falls back to empty.
 */
export function loadWorkspacePrefs(): WorkspacePrefs {
  if (typeof localStorage === "undefined") {
    return { ...EMPTY, knownWorkspaces: [] };
  }
  try {
    const raw = localStorage.getItem(WORKSPACE_PREFS_KEY);
    if (!raw) {
      return { ...EMPTY, knownWorkspaces: [] };
    }
    return normalizeWorkspacePrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...EMPTY, knownWorkspaces: [] };
  }
}

/**
 * Resolve the workspace path the switcher should show / New chat should use.
 * When {@link WorkspacePrefs.noProject} is set, always returns "" so bridge
 * default cwd cannot reappear as the selected project.
 * @param prefs Loaded workspace prefs.
 * @param sessionWorkspace Live session.workspace (may be bridge default).
 * @returns Absolute path or empty for no project.
 */
export function resolvePreferredWorkspace(
  prefs: WorkspacePrefs,
  sessionWorkspace: string,
): string {
  if (prefs.noProject) {
    return "";
  }
  const active = prefs.activeWorkspace.trim();
  if (active) {
    return active;
  }
  return sessionWorkspace.trim();
}

/**
 * Persist workspace prefs to localStorage.
 * @param prefs Latest active + known lists; overwrites the previous blob.
 */
export function saveWorkspacePrefs(prefs: WorkspacePrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      WORKSPACE_PREFS_KEY,
      JSON.stringify(normalizeWorkspacePrefs(prefs)),
    );
  } catch {
    // quota / private mode — ignore
  }
}

/**
 * Set the default active workspace (empty = no project).
 * Does not touch knownWorkspaces.
 * @param prefs Current prefs (not mutated).
 * @param workspace Absolute path or empty string.
 * @returns New prefs with activeWorkspace updated.
 */
export function setActiveWorkspacePrefs(
  prefs: WorkspacePrefs,
  workspace: string,
): WorkspacePrefs {
  const path = workspace.trim();
  if (!path) {
    return {
      ...prefs,
      activeWorkspace: "",
      noProject: true,
    };
  }
  return {
    ...prefs,
    activeWorkspace: path,
    noProject: false,
  };
}

/**
 * Remember a project path in knownWorkspaces (front if new) and set it active.
 * Empty path clears active and sets {@link WorkspacePrefs.noProject}.
 * @param prefs Current prefs (not mutated).
 * @param workspace Absolute path or empty for "no project".
 * @returns New prefs with known + active + noProject updated.
 */
export function rememberAndActivateWorkspace(
  prefs: WorkspacePrefs,
  workspace: string,
): WorkspacePrefs {
  const path = workspace.trim();
  if (!path) {
    return {
      ...prefs,
      activeWorkspace: "",
      noProject: true,
    };
  }
  const known = [
    path,
    ...prefs.knownWorkspaces.filter((w) => w !== path),
  ];
  return {
    activeWorkspace: path,
    knownWorkspaces: known,
    noProject: false,
  };
}

/**
 * Display name for a workspace path (last path segment).
 * @param workspace Absolute path or empty.
 * @returns Basename, or "No project" when empty.
 */
export function workspaceDisplayName(workspace: string): string {
  const cleaned = workspace.replace(/[/\\]+$/, "").trim();
  if (!cleaned) {
    return "No project";
  }
  const parts = cleaned.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

/**
 * Merge known prefs paths with catalog workspaces for the project switcher list.
 * Active path is included even if not yet in either source. Empty paths dropped.
 * Sorted by display name first-character code unit (asc).
 * @param known From prefs.knownWorkspaces.
 * @param catalogWorkspaces Distinct workspace paths from the session catalog.
 * @param active Current active / session workspace (may be empty).
 * @returns Unique absolute paths for the menu.
 */
export function collectProjectWorkspacePaths(
  known: string[],
  catalogWorkspaces: string[],
  active: string,
): string[] {
  const set = new Set<string>();
  for (const w of known) {
    const t = w.trim();
    if (t) {
      set.add(t);
    }
  }
  for (const w of catalogWorkspaces) {
    const t = w.trim();
    if (t) {
      set.add(t);
    }
  }
  const activeTrim = active.trim();
  if (activeTrim) {
    set.add(activeTrim);
  }
  return [...set].sort((a, b) => {
    const na = workspaceDisplayName(a);
    const nb = workspaceDisplayName(b);
    const ca = na.charCodeAt(0);
    const cb = nb.charCodeAt(0);
    if (ca !== cb) {
      return ca - cb;
    }
    if (na !== nb) {
      return na < nb ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Dedupe path arrays while preserving first-seen order.
 * @param value Unknown list; non-string / empty dropped.
 */
function uniquePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const t = item.trim();
    if (!t || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}
