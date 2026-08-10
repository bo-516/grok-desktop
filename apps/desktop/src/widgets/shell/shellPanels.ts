/**
 * Pure shell panel / context-rail helpers.
 * Mutual exclusion is expressed as a single PanelId | null so callers cannot
 * open two drawers at once without an explicit replace.
 */

/** Side-drawer panels opened from footer / ⌘K / events. */
export type PanelId = "settings" | "extensions" | "overview" | "tasks";

/** Right context rail content: plan checklist or code/diff preview. */
export type ContextRailId = "plan" | "preview";

/** Plan rail default width in px (matches --rail-right-width). */
export const PLAN_RAIL_WIDTH = 280;

/**
 * Resolve the CSS pixel width for the active context rail.
 * @param rail Current rail id or null when closed.
 * @param previewWidth Committed preview width from previewStore.
 * @returns Width in px; plan uses fixed 280, preview uses stored width.
 */
export function contextRailWidthPx(
  rail: ContextRailId | null,
  previewWidth: number,
): number {
  if (rail === "preview") {
    return previewWidth;
  }
  return PLAN_RAIL_WIDTH;
}

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
 * Must not steal an already-open preview rail (or plan rail).
 * @param planLength Number of plan steps on the session.
 * @param contextRail Current rail visibility (`null` when closed).
 * @param userClosedRail True when the user closed the rail this session.
 * @returns True only when plan first arrives, rail is closed, and user has not dismissed it.
 */
export function shouldAutoOpenPlanRail(
  planLength: number,
  contextRail: ContextRailId | null,
  userClosedRail: boolean,
): boolean {
  if (userClosedRail) {
    return false;
  }
  // Any open rail (plan or preview) must stay put — openPreview owns "preview".
  if (contextRail !== null) {
    return false;
  }
  return planLength > 0;
}
