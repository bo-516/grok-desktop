/** Shell chrome feature entry — panels, banners, shell hook. */

export { ShellBannersView } from "./ShellBannersView";
export type { ShellBannersViewProps } from "./ShellBannersView";
export {
  openExclusivePanel,
  shouldAutoOpenPlanRail,
  toggleContextRail,
  toggleExclusivePanel,
  type ContextRailId,
  type PanelId,
} from "./shellPanels";
export { useAppShellWidget } from "./useAppShellWidget";
