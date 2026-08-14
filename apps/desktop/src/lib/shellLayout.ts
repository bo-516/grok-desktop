/**
 * Shell column layout: keep the transcript at a minimum width by
 * collapsing the session rail and, if still short, overlaying the
 * right drawer instead of pushing the main column.
 *
 * Three tiers when the user prefers push:
 *   1. Wide — docked left + main + pushing right rail.
 *   2. Medium — left becomes an off-canvas overlay (hamburger);
 *      the right rail still pushes so the transcript is not covered.
 *   3. Narrow — both rails overlay the main column (full-bleed chat).
 *
 * Overlay preference always skips push; left still docks only when
 * the main minimum fits beside the sidebar.
 */

import type { DrawerLayout } from "./contextDrawerPrefs";

/**
 * Left session-rail width in CSS pixels.
 * Must stay in sync with `--sidebar-width` in defineColor.css.
 */
export const SIDEBAR_WIDTH_PX = 272;

/**
 * Minimum reserved width for the main (transcript + composer) column.
 * Must stay in sync with `--main-column-min-width` in defineColor.css.
 * Below this the shell sheds the left rail, then overlays the right
 * companion, rather than crushing composer chrome into overlapping chips.
 */
export const MAIN_COLUMN_MIN_WIDTH = 560;

/** Inputs for {@link resolveShellLayout}. */
export type ShellLayoutInput = {
  /** Current window `innerWidth` in CSS pixels. */
  viewportWidth: number;
  /**
   * Whether a right companion (plan / agents / preview) is open.
   * Closed rail never reserves push space.
   */
  rightRailOpen: boolean;
  /**
   * Open right-rail width in px (preview store or shared Plan|Agents width).
   * Ignored when `rightRailOpen` is false.
   */
  rightRailWidth: number;
  /**
   * Stored user preference. `"overlay"` always overlays the right rail;
   * `"push"` is granted only when the main minimum still fits.
   */
  drawerPref: DrawerLayout;
};

/** Effective chrome after applying the three-tier clamp. */
export type ShellLayout = {
  /**
   * True when the session rail occupies layout space (docked).
   * False: off-canvas overlay; top-nav shows the hamburger.
   */
  sidebarDocked: boolean;
  /** How the open right rail treats the main column. */
  drawerLayout: DrawerLayout;
};

/**
 * Decide dock-vs-overlay for the left rail and push-vs-overlay for the right.
 * Never mutates the stored drawer preference — only returns what the shell
 * should apply for this viewport and this open-rail width.
 *
 * @param input Viewport, open-rail geometry, and the stored layout pref.
 * @returns Dock flag plus the effective right-rail layout.
 */
export function resolveShellLayout(input: ShellLayoutInput): ShellLayout {
  const viewportWidth = Math.max(0, input.viewportWidth);
  const railWidth = Math.max(0, input.rightRailWidth);
  const leftPlusMain = SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH;

  if (input.drawerPref !== "push") {
    return {
      sidebarDocked: viewportWidth >= leftPlusMain,
      drawerLayout: "overlay",
    };
  }

  if (!input.rightRailOpen) {
    return {
      sidebarDocked: viewportWidth >= leftPlusMain,
      drawerLayout: "push",
    };
  }

  const threeCol = leftPlusMain + railWidth;
  if (viewportWidth >= threeCol) {
    return { sidebarDocked: true, drawerLayout: "push" };
  }

  const twoColPush = MAIN_COLUMN_MIN_WIDTH + railWidth;
  if (viewportWidth >= twoColPush) {
    return { sidebarDocked: false, drawerLayout: "push" };
  }

  return { sidebarDocked: false, drawerLayout: "overlay" };
}
