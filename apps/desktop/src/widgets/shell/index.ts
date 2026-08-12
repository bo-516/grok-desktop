/** Shell chrome feature entry — panels, banners, shell hook. */

export { ShellBannersView } from "./ShellBannersView";
export type { ShellBannersViewProps } from "./ShellBannersView";
export {
  contextRailAfterSessionChange,
  contextRailHasContent,
  contextRailWidthPx,
  openExclusivePanel,
  PLAN_RAIL_WIDTH,
  shouldAutoOpenPlanRail,
  toggleContextRail,
  toggleExclusivePanel,
  type ContextRailId,
  type EnvironmentPageId,
  type PanelId,
} from "./shellPanels";
export { useAppShellWidget } from "./useAppShellWidget";
