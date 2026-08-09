/**
 * Light/dark theme toggle (F-NATIVE-02) using data-theme + defineColor tokens.
 */

export type ThemeId = "dark" | "light";

const STORAGE_KEY = "grok-desktop.theme.v1";

/**
 * Load persisted theme; default dark (product default).
 */
export function loadTheme(): ThemeId {
  if (typeof localStorage === "undefined") {
    return "dark";
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") {
      return raw;
    }
  } catch {
    /* private mode */
  }
  return "dark";
}

/**
 * Persist and apply theme to documentElement.
 * @param theme light | dark.
 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<ThemeId>("grok-desktop:theme-changed", {
        detail: theme,
      }),
    );
  }
}

/**
 * Toggle between light and dark.
 * @param current Current theme.
 */
export function toggleTheme(current: ThemeId): ThemeId {
  return current === "dark" ? "light" : "dark";
}
