/**
 * Composer context-usage meter prefs (show/hide ring).
 * Pure helpers + localStorage — no React. Instant UI chrome, no session restart.
 */

/** localStorage key for the composer context usage visibility pref. */
export const CONTEXT_USAGE_PREFS_KEY = "grok-desktop.context-usage-prefs.v1";

/** Persisted preference for the session token / context ring on the composer. */
export type ContextUsagePrefs = {
  /**
   * When true, the composer shows a context-fill ring left of the send button
   * with token counts and percent (from `turn_completed` + model context limit).
   */
  showContextUsage: boolean;
};

/** Default: on — long sessions need a glanceable context meter (F-CTX-01). */
const DEFAULT_PREFS: ContextUsagePrefs = { showContextUsage: true };

/**
 * Normalize a prefs blob from storage or partial input.
 * Anything unparseable falls back to the product default (show the meter).
 * @param raw Unknown parse result or partial object.
 * @returns Defensive prefs with a boolean showContextUsage.
 */
export function normalizeContextUsagePrefs(raw: unknown): ContextUsagePrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.showContextUsage === false) {
    return { showContextUsage: false };
  }
  if (obj.showContextUsage === true) {
    return { showContextUsage: true };
  }
  return { ...DEFAULT_PREFS };
}

/**
 * Load context-usage prefs from localStorage (browser). SSR/Node → defaults.
 * @returns Valid prefs; corrupt JSON falls back to show=true.
 */
export function loadContextUsagePrefs(): ContextUsagePrefs {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = localStorage.getItem(CONTEXT_USAGE_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFS };
    }
    return normalizeContextUsagePrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Persist context-usage prefs to localStorage.
 * Failures (quota / private mode) are swallowed — UI state still works in-session.
 * @param prefs Latest visibility preference; overwrites the previous blob.
 */
export function saveContextUsagePrefs(prefs: ContextUsagePrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      CONTEXT_USAGE_PREFS_KEY,
      JSON.stringify(normalizeContextUsagePrefs(prefs)),
    );
  } catch {
    // quota / private mode — ignore
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ContextUsagePrefs>("grok-desktop:context-usage-prefs-changed", {
        detail: normalizeContextUsagePrefs(prefs),
      }),
    );
  }
}

/**
 * Whether the composer should render the context usage ring.
 * @param prefs Current prefs blob.
 */
export function isContextUsageVisible(prefs: ContextUsagePrefs): boolean {
  return prefs.showContextUsage === true;
}
