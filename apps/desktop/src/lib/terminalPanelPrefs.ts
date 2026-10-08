/**
 * Terminal panel prefs (open + height), per viewer in localStorage.
 * Pure helpers + guarded storage — no React. Global for all sessions:
 * the dock is window chrome, not chat state.
 */

/** localStorage key for the terminal panel prefs blob. */
export const TERMINAL_PANEL_PREFS_KEY = "grok-desktop.terminal-panel.v1";

/** Default dock height in px (about 14 rows of 12px mono plus the tab bar). */
export const TERMINAL_PANEL_HEIGHT_DEFAULT = 260;

/** Smallest dock height in px: tab bar plus ~3 rows stay usable. */
export const TERMINAL_PANEL_HEIGHT_MIN = 120;

/**
 * Largest share of the viewport the dock may take, so the timeline and
 * composer above it never collapse to nothing.
 */
export const TERMINAL_PANEL_MAX_VIEWPORT_RATIO = 0.75;

/** Persisted terminal dock preferences. */
export type TerminalPanelPrefs = {
  /** Whether the dock was open when last toggled. */
  open: boolean;
  /** Last dragged height in px (clamped again against the live viewport). */
  height: number;
};

/** Defaults: closed, default height. */
const DEFAULT_PREFS: TerminalPanelPrefs = {
  open: false,
  height: TERMINAL_PANEL_HEIGHT_DEFAULT,
};

/**
 * Clamp a dock height against the current viewport.
 * @param height Requested height in px (NaN / non-finite → default).
 * @param viewportHeight `window.innerHeight`; <= 0 skips the viewport cap.
 * @returns Integer px between TERMINAL_PANEL_HEIGHT_MIN and the viewport cap
 *   (the minimum wins when the viewport is tiny).
 */
export function clampTerminalPanelHeight(
  height: number,
  viewportHeight: number,
): number {
  const base = Number.isFinite(height) ? height : TERMINAL_PANEL_HEIGHT_DEFAULT;
  const cap =
    viewportHeight > 0
      ? Math.floor(viewportHeight * TERMINAL_PANEL_MAX_VIEWPORT_RATIO)
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.max(TERMINAL_PANEL_HEIGHT_MIN, Math.min(base, cap)));
}

/**
 * Normalize a prefs blob from storage or partial input.
 * @param raw Unknown parse result.
 * @returns Valid prefs; wrong types fall back field by field.
 */
export function normalizeTerminalPanelPrefs(raw: unknown): TerminalPanelPrefs {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  const height =
    typeof obj.height === "number" && Number.isFinite(obj.height)
      ? Math.max(TERMINAL_PANEL_HEIGHT_MIN, Math.round(obj.height))
      : DEFAULT_PREFS.height;
  return { open: obj.open === true, height };
}

/**
 * Load prefs from localStorage. Node / private mode / corrupt JSON → defaults.
 * @returns Valid prefs.
 */
export function loadTerminalPanelPrefs(): TerminalPanelPrefs {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_PREFS };
  }
  try {
    const raw = localStorage.getItem(TERMINAL_PANEL_PREFS_KEY);
    return raw
      ? normalizeTerminalPanelPrefs(JSON.parse(raw) as unknown)
      : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Persist prefs. Failures (quota / private mode) are swallowed — the dock
 * still works for this session.
 * @param prefs Latest prefs; overwrites the previous blob.
 */
export function saveTerminalPanelPrefs(prefs: TerminalPanelPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      TERMINAL_PANEL_PREFS_KEY,
      JSON.stringify(normalizeTerminalPanelPrefs(prefs)),
    );
  } catch {
    // quota / private mode — ignore
  }
}
