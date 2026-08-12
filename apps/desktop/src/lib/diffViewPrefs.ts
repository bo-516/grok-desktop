/**
 * Diff reading layout preferences (wrap, dual gutter, full-file intent).
 * Pure helpers + localStorage — no React. Instant chrome; no session restart.
 */

/** localStorage key for structured-diff reading prefs. */
export const DIFF_VIEW_PREFS_KEY = "grok-desktop.diff-view-prefs.v1";

/**
 * User-tunable diff layout flags.
 * `preferFullFile` is a sticky toggle: on expands every unmodified gap (when
 * under the 5000-line gate); off collapses gaps back to change-only fragments.
 * The widget may still refuse to expand oversized files; the pref records intent.
 */
export type DiffViewPrefs = {
  /** Soft-wrap code lines in the diff body. */
  wrap: boolean;
  /** Show old + new line-number columns instead of a single (new-side) column. */
  dualGutter: boolean;
  /**
   * Sticky show-full-file intent. True → expand all gaps; false → change hunks
   * only (gap bands). Applied when the file is under the line gate.
   */
  preferFullFile: boolean;
};

/**
 * Product defaults: wrap on (narrow drawer readability), single gutter,
 * gaps stay collapsed until the user expands. Exported for tests / chrome that
 * need the same source of truth as localStorage fallbacks.
 */
export const DEFAULT_PREFS: DiffViewPrefs = {
  wrap: true,
  dualGutter: false,
  preferFullFile: false,
};

/**
 * Normalize a prefs blob from storage or partial input.
 * Unknown / non-boolean fields fall back to product defaults.
 * `wrap` accepts explicit false so users can turn soft-wrap off; missing wrap
 * uses DEFAULT_PREFS.wrap (true). Dual gutter / full-file stay opt-in only.
 * @param raw Unknown parse result or partial object.
 */
export function normalizeDiffViewPrefs(raw: unknown): DiffViewPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    wrap: typeof obj.wrap === "boolean" ? obj.wrap : DEFAULT_PREFS.wrap,
    dualGutter: obj.dualGutter === true,
    preferFullFile: obj.preferFullFile === true,
  };
}

/**
 * Load diff view prefs from localStorage (browser). SSR/Node → defaults.
 * @returns Valid prefs; corrupt JSON falls back to defaults.
 */
export function loadDiffViewPrefs(): DiffViewPrefs {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = localStorage.getItem(DIFF_VIEW_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_PREFS };
    }
    return normalizeDiffViewPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Persist diff view prefs. No-op when localStorage is unavailable.
 * @param prefs Prefs to write (normalized before store).
 */
export function saveDiffViewPrefs(prefs: DiffViewPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const normalized = normalizeDiffViewPrefs(prefs);
    localStorage.setItem(DIFF_VIEW_PREFS_KEY, JSON.stringify(normalized));
  } catch {
    // Quota / private mode — chrome still works in-memory for the session.
  }
}

/**
 * Merge a partial update onto current prefs and return the new object.
 * @param current Current prefs.
 * @param patch Fields to override.
 */
export function patchDiffViewPrefs(
  current: DiffViewPrefs,
  patch: Partial<DiffViewPrefs>,
): DiffViewPrefs {
  return normalizeDiffViewPrefs({ ...current, ...patch });
}
