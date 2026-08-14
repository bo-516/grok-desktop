/**
 * Left session-rail visibility prefs (user collapse vs viewport dock).
 * Pure helpers + localStorage — no React. Viewport dock math stays in
 * {@link ./shellLayout}; this module only persists the user's hide choice
 * so a wide window does not force the rail back open after collapse.
 */

/** localStorage key for left-rail visibility prefs (global, all sessions). */
export const SIDEBAR_PREFS_KEY = "grok-desktop.sidebar-prefs.v1";

/** Persisted hide choice for the left session rail. */
export type SidebarPrefs = {
  /**
   * True when the user hid the rail via the header collapse control.
   * Independent of viewport dock: a wide window still honors this until
   * they reopen from the top-nav hamburger.
   */
  collapsed: boolean;
};

/** Default: rail follows viewport dock (visible whenever it fits). */
const DEFAULT_PREFS: SidebarPrefs = { collapsed: false };

/**
 * Normalize a prefs blob from storage or partial input.
 * Anything unparseable degrades to not-collapsed (dock when the viewport allows).
 * @param raw Unknown parse result or partial object.
 * @returns Defensive prefs with a boolean `collapsed`.
 */
export function normalizeSidebarPrefs(raw: unknown): SidebarPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return { collapsed: obj.collapsed === true };
}

/**
 * Load left-rail visibility prefs from localStorage (browser). SSR/Node → defaults.
 * @returns Valid prefs; corrupt JSON falls back to not-collapsed.
 */
export function loadSidebarPrefs(): SidebarPrefs {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = localStorage.getItem(SIDEBAR_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFS };
    }
    return normalizeSidebarPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Persist left-rail visibility prefs to localStorage.
 * Failures (quota / private mode) are swallowed — UI state still works in-session.
 * @param prefs Latest hide choice; overwrites the previous blob.
 */
export function saveSidebarPrefs(prefs: SidebarPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      SIDEBAR_PREFS_KEY,
      JSON.stringify(normalizeSidebarPrefs(prefs)),
    );
  } catch {
    // quota / private mode — ignore
  }
}

/**
 * Whether the session rail occupies layout space.
 * Viewport must be wide enough to dock AND the user must not have collapsed it.
 * @param layoutCanDock Viewport dock from {@link resolveShellLayout}.
 * @param userCollapsed Stored hide choice.
 * @returns True when the main column should reserve `--sidebar-width`.
 */
export function isSidebarDocked(
  layoutCanDock: boolean,
  userCollapsed: boolean,
): boolean {
  return layoutCanDock && !userCollapsed;
}

/**
 * Header collapse click: persist hide when the rail is occupying space;
 * otherwise just dismiss the overlay (narrow / already-hidden).
 * @param args Current viewport dock + stored hide choice.
 * @returns `"persist-collapse"` to write prefs; `"close-overlay"` to only close.
 */
export function sidebarCollapseAction(args: {
  /** Viewport would dock the rail if the user had not hidden it. */
  layoutCanDock: boolean;
  /** Stored hide choice. */
  userCollapsed: boolean;
}): "persist-collapse" | "close-overlay" {
  if (args.layoutCanDock && !args.userCollapsed) {
    return "persist-collapse";
  }
  return "close-overlay";
}

/**
 * Top-nav hamburger click: re-dock when the user hid a rail that still fits;
 * otherwise toggle the off-canvas overlay (narrow viewport).
 * @param args Current viewport dock + stored hide choice.
 * @returns `"re-dock"` to clear the hide pref; `"toggle-overlay"` to flip `railOpen`.
 */
export function sidebarToggleAction(args: {
  /** Viewport would dock the rail if the user had not hidden it. */
  layoutCanDock: boolean;
  /** Stored hide choice. */
  userCollapsed: boolean;
}): "re-dock" | "toggle-overlay" {
  if (args.userCollapsed && args.layoutCanDock) {
    return "re-dock";
  }
  return "toggle-overlay";
}
