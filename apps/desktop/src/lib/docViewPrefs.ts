/**
 * Document preview mode preferences (rendered vs source).
 * Pure helpers + localStorage — no React. Global (not per-file), same grain as
 * diffViewPrefs: the user intends "read docs" or "read source", not per path.
 */

/** localStorage key (versioned; same naming convention as diff-view-prefs). */
export const DOC_VIEW_PREFS_KEY = "grok-desktop.doc-view-prefs.v1";

/** Last chosen document body mode in the preview drawer. */
export type DocViewMode = "rendered" | "source";

/** Persisted document-view prefs blob. */
export type DocViewPrefs = {
  /** Last Markdown file view shape the user picked. */
  mode: DocViewMode;
};

/**
 * Product default: open docs in the rendered document view.
 * Exported so chrome and tests share one source of truth with storage fallbacks.
 */
export const DEFAULT_DOC_PREFS: DocViewPrefs = { mode: "rendered" };

/**
 * True when `value` is a supported DocViewMode.
 * @param value Unknown candidate from storage or UI.
 */
function isDocViewMode(value: unknown): value is DocViewMode {
  return value === "rendered" || value === "source";
}

/**
 * Normalize a prefs blob from storage or partial input.
 * Unknown / invalid fields fall back to product defaults.
 * @param raw Unknown parse result or partial object.
 * @returns A complete valid DocViewPrefs object.
 */
export function normalizeDocViewPrefs(raw: unknown): DocViewPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_DOC_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    mode: isDocViewMode(obj.mode) ? obj.mode : DEFAULT_DOC_PREFS.mode,
  };
}

/**
 * Load document view prefs from localStorage (browser). SSR/Node → defaults.
 * @returns Valid prefs; corrupt JSON falls back to defaults without throwing.
 */
export function loadDocViewPrefs(): DocViewPrefs {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_DOC_PREFS };
  }
  try {
    const raw = localStorage.getItem(DOC_VIEW_PREFS_KEY);
    if (!raw) {
      return { ...DEFAULT_DOC_PREFS };
    }
    return normalizeDocViewPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_DOC_PREFS };
  }
}

/**
 * Persist document view prefs. No-op when localStorage is unavailable.
 * @param prefs Prefs to write (normalized before store).
 */
export function saveDocViewPrefs(prefs: DocViewPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    const normalized = normalizeDocViewPrefs(prefs);
    localStorage.setItem(DOC_VIEW_PREFS_KEY, JSON.stringify(normalized));
  } catch {
    // Quota / private mode — in-memory session still works for the session.
  }
}

/**
 * Merge a partial update onto current prefs and return the new object.
 * @param current Current prefs.
 * @param patch Fields to override.
 * @returns Normalized prefs after applying the patch.
 */
export function patchDocViewPrefs(
  current: DocViewPrefs,
  patch: Partial<DocViewPrefs>,
): DocViewPrefs {
  return normalizeDocViewPrefs({ ...current, ...patch });
}
