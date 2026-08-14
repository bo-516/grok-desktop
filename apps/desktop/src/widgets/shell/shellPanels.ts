/**
 * Pure shell panel / context-rail helpers.
 * Mutual exclusion is expressed as a single PanelId | null so callers cannot
 * open two drawers at once without an explicit replace.
 */

import { AGENTS_WIDTH_DEFAULT } from "@/lib/agentsPanelWidth";

/**
 * Exclusive chrome panels opened from footer / ⌘K / events (workspace / app scope).
 * `environment` is a centered modal sheet; settings/overview remain side drawers.
 */
export type PanelId = "settings" | "environment" | "overview";

/**
 * Environment sheet page ids for deep links (mirrors environmentStore).
 * Kept here so shell events do not import the store module.
 */
export type EnvironmentPageId =
  | "overview"
  | "mcp"
  | "skills"
  | "agents"
  | "plugins"
  | "marketplaces"
  | "hooks"
  | "rules"
  | "compat";

/** Right context rail content: plan, agents, or code/diff preview. */
export type ContextRailId = "plan" | "preview" | "agents";

/**
 * Closed-rail CSS fallback in px (matches --rail-right-width).
 * Plan and Agents share the persisted companion width instead of this token.
 */
export const PLAN_RAIL_WIDTH = 280;

/**
 * Resolve the CSS pixel width for the active context rail.
 * Plan and Agents are one drawer — they share `companionWidth` so tab
 * switches do not resize the rail or the main-column push padding.
 * @param rail Current rail id or null when closed.
 * @param previewWidth Committed preview width from previewStore.
 * @param companionWidth Persisted Plan|Agents drawer width from agentsPanelStore.
 * @returns Width in px; preview uses its own store; plan/agents share companionWidth.
 */
export function contextRailWidthPx(
  rail: ContextRailId | null,
  previewWidth: number,
  companionWidth: number = AGENTS_WIDTH_DEFAULT,
): number {
  if (rail === "preview") {
    return previewWidth;
  }
  if (rail === "plan" || rail === "agents") {
    return companionWidth;
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

/**
 * Context rail after a session id change (new chat or catalog switch).
 * Plan|Agents are session-scoped companions and close by default so an empty
 * "No plan yet" drawer does not follow the user into the next chat. Preview
 * is left alone — it is file/diff chrome, not chat-bound.
 * @param current Rail open before the session switch, or null when closed.
 * @returns null when plan/agents were open; otherwise `current` unchanged.
 */
export function contextRailAfterSessionChange(
  current: ContextRailId | null,
): ContextRailId | null {
  if (current === "plan" || current === "agents") {
    return null;
  }
  return current;
}

/**
 * Whether the open context rail should reserve main-column push space.
 *
 * Any open rail (Plan, Agents, or Preview) reserves space when push is
 * preferred — including empty Plan/Agents — so opening the companion always
 * squeezes the transcript instead of overlaying it. Closed rail (`null`)
 * never reserves space.
 *
 * @param rail Active context rail id, or null when closed.
 * @returns True when push layout may apply padding for this open rail.
 */
export function contextRailHasContent(rail: ContextRailId | null): boolean {
  return rail !== null;
}
