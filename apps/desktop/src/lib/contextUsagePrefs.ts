/**
 * Composer usage chrome prefs (context ring + weekly remaining).
 * Pure helpers + localStorage — no React. Instant UI chrome, no session restart.
 */

/** localStorage key for the composer context usage visibility pref. */
export const CONTEXT_USAGE_PREFS_KEY = "grok-desktop.context-usage-prefs.v1";

/** Persisted preference for the session token / context ring on the composer. */
export type ContextUsagePrefs = {
  /**
   * When true, the composer shows a context-fill ring left of the send button
   * with occupancy / window percent (from live `_meta.totalTokens` + model
   * context limit). Hover also lists last-turn billed token usage when present.
   */
  showContextUsage: boolean;
  /**
   * When true, the composer shows weekly (or monthly) remaining allowance
   * immediately left of the context ring. Account-level, from `_x.ai/billing`.
   */
  showWeeklyUsage: boolean;
};

/**
 * Default: both on — long sessions need a glanceable context meter (F-CTX-01)
 * and SuperGrok weekly remaining should not be a hidden TUI-only number.
 */
const DEFAULT_PREFS: ContextUsagePrefs = {
  showContextUsage: true,
  showWeeklyUsage: true,
};

/**
 * Coerce one stored flag: explicit false stays off; anything else uses default.
 * Missing keys (legacy blobs that only stored showContextUsage) keep the
 * product default so adding a new chrome toggle never silently hides it.
 * @param value Raw JSON field.
 * @param fallback Product default when the key is absent / unparseable.
 * @returns Defensive boolean.
 */
function readFlag(value: unknown, fallback: boolean): boolean {
  if (value === false) {
    return false;
  }
  if (value === true) {
    return true;
  }
  return fallback;
}

/**
 * Normalize a prefs blob from storage or partial input.
 * Anything unparseable falls back to the product default (both meters on).
 * @param raw Unknown parse result or partial object.
 * @returns Defensive prefs with boolean showContextUsage + showWeeklyUsage.
 */
export function normalizeContextUsagePrefs(raw: unknown): ContextUsagePrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    showContextUsage: readFlag(
      obj.showContextUsage,
      DEFAULT_PREFS.showContextUsage,
    ),
    showWeeklyUsage: readFlag(obj.showWeeklyUsage, DEFAULT_PREFS.showWeeklyUsage),
  };
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
 * Persist composer usage prefs to localStorage.
 * Failures (quota / private mode) are swallowed — UI state still works in-session.
 * @param prefs Latest visibility flags; missing keys keep the previous / default value.
 */
export function saveContextUsagePrefs(prefs: Partial<ContextUsagePrefs>): void {
  const next = normalizeContextUsagePrefs({
    ...loadContextUsagePrefs(),
    ...prefs,
  });
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(CONTEXT_USAGE_PREFS_KEY, JSON.stringify(next));
    } catch {
      // quota / private mode — ignore
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ContextUsagePrefs>(
        "grok-desktop:context-usage-prefs-changed",
        { detail: next },
      ),
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

/**
 * Whether the composer should render weekly remaining allowance.
 * @param prefs Current prefs blob.
 */
export function isWeeklyUsageVisible(prefs: ContextUsagePrefs): boolean {
  return prefs.showWeeklyUsage === true;
}
