/**
 * Code-split panel entry points — import from `@/widgets/lazyPanels`.
 * App mounts the `Lazy*Widget` wrappers; trigger surfaces may call
 * `<entry>.preload()` from the panel entries for hover / intent prefetch.
 */

export {
  LazyEnvironmentSheetWidget,
  LazyPreviewDrawerWidget,
  LazySettingsPanelWidget,
} from "./LazyPanelWidgets";
export type { LazySettingsPanelWidgetProps } from "./LazyPanelWidgets";
export {
  environmentSheetPanel,
  previewDrawerPanel,
  settingsPanel,
} from "./panelEntries";
export { createLazyPanel } from "./createLazyPanel";
export type { LazyPanel, LazyPanelLoader } from "./createLazyPanel";
export { useLazyPanelMount } from "./useLazyPanelMount";
export type { LazyPanelMountOptions } from "./useLazyPanelMount";
export { PreviewDrawerPlaceholderView } from "./PreviewDrawerPlaceholderView";
export type { PreviewDrawerPlaceholderViewProps } from "./PreviewDrawerPlaceholderView";
