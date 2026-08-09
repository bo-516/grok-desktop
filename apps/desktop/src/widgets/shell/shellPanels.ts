/**
 * Pure shell panel / context-rail helpers.
 * Mutual exclusion is expressed as a single PanelId | null so callers cannot
 * open two drawers at once without an explicit replace.
 */

/** Side-drawer panels opened from footer / ⌘K / events. */
export type PanelId = "settings" | "extensions" | "overview" | "tasks";

/** Right context rail content; M1 only mounts plan. */
export type ContextRailId = "plan";

/**
 * Toggle a panel: same id closes; any other id replaces (exclusive).
 * @param current Currently open panel or null.
 * @param next Panel the user requested.
 * @returns New exclusive active panel.
 */
export function toggleExclusivePanel(
  current: PanelId | null,
  next: PanelId,
): PanelId | null {
  return current === next ? null : next;
}

/**
 * Open a panel exclusively (does not toggle closed if already open).
 * Used by open-panel events that mean "show this", not "flip".
 * @param _current Ignored; kept for call-site symmetry with toggle.
 * @param next Panel to open.
 * @returns Always `next`.
 */
export function openExclusivePanel(
  _current: PanelId | null,
  next: PanelId,
): PanelId {
  return next;
}

/**
 * Toggle context rail open/closed for a given content id.
 * @param current Current rail content or null when closed.
 * @param next Content the user wants visible.
 * @returns null when closing the same content; otherwise next.
 */
export function toggleContextRail(
  current: ContextRailId | null,
  next: ContextRailId,
): ContextRailId | null {
  return current === next ? null : next;
}

/**
 * Whether plan auto-open should run for this session.
 * @param planLength Number of plan steps on the session.
 * @param contextRail Current rail visibility.
 * @param userClosedRail True when the user closed the rail this session.
 * @returns True only when plan first arrives and user has not dismissed it.
 */
export function shouldAutoOpenPlanRail(
  planLength: number,
  contextRail: ContextRailId | null,
  userClosedRail: boolean,
): boolean {
  if (userClosedRail) {
    return false;
  }
  if (contextRail === "plan") {
    return false;
  }
  return planLength > 0;
}
