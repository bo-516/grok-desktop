/**
 * Context-drawer layout prefs (push vs overlay).
 * Pure helpers + localStorage — no React. Global for all sessions.
 * Narrow-window clamp lives in `resolveShellLayout` so it can see the
 * live rail width and the main-column minimum; this module only persists
 * the user's preference.
 */

/** localStorage key for context-drawer layout prefs (global, all sessions). */
export const CONTEXT_DRAWER_PREFS_KEY = "grok-desktop.context-drawer-prefs.v1";

/** How the open drawer treats the main column. */
export type DrawerLayout = "push" | "overlay";

/** Persisted layout preference for the plan companion drawer. */
export type ContextDrawerPrefs = {
  /** User-chosen layout; may differ from effective layout under narrow clamp. */
  layout: DrawerLayout;
};

/** Default: push — the drawer never covers the transcript. */
const DEFAULT_PREFS: ContextDrawerPrefs = { layout: "push" };

/**
 * Normalize a prefs blob from storage or partial input.
 * Anything unparseable degrades to push rather than overlay.
 * @param raw Unknown parse result or partial object.
 * @returns Defensive prefs with a valid DrawerLayout.
 */
export function normalizeContextDrawerPrefs(raw: unknown): ContextDrawerPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.layout === "overlay") {
    return { layout: "overlay" };
  }
  return { layout: "push" };
}

/**
 * Load context-drawer prefs from localStorage (browser). SSR/Node → defaults.
 * @returns Valid prefs; corrupt JSON falls back to push.
 */
export function loadContextDrawerPrefs(): ContextDrawerPrefs {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = localStorage.getItem(CONTEXT_DRAWER_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFS };
    }
    return normalizeContextDrawerPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Persist context-drawer prefs to localStorage.
 * Failures (quota / private mode) are swallowed — UI state still works in-session.
 * @param prefs Latest layout preference; overwrites the previous blob.
 */
export function saveContextDrawerPrefs(prefs: ContextDrawerPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      CONTEXT_DRAWER_PREFS_KEY,
      JSON.stringify(normalizeContextDrawerPrefs(prefs)),
    );
  } catch {
    // quota / private mode — ignore
  }
}


