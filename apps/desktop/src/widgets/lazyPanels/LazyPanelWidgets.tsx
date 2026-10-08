/**
 * Code-split panel entry points mounted by App.
 *
 * Each wrapper takes exactly the props of the panel it stands for, so App
 * only swaps the tag. Mount timing lives in useLazyPanelMount (idle warm-up,
 * intent prefetch, deferred mount); see that hook for why panels mount closed
 * in the background instead of on first open.
 *
 * Fallbacks: overlay panels (Settings, Environment) render nothing until
 * their chunk is ready — they float above the shell, so there is no layout
 * to hold, and a stand-in modal would replay its enter animation when the
 * real one replaced it. The preview drawer can push the main column, so it
 * gets PreviewDrawerPlaceholderView.
 */

import { Suspense, type ComponentProps } from "react";
import type { EnvironmentSheetWidgetProps } from "@/widgets/environment";
import type { PreviewDrawerWidgetProps } from "@/widgets/preview";
import type { SettingsPanelWidget } from "@/widgets/SettingsPanelWidget";
import { usePreviewStore } from "@/store/previewStore";
import {
  environmentSheetPanel,
  previewDrawerPanel,
  settingsPanel,
} from "./panelEntries";
import { PreviewDrawerPlaceholderView } from "./PreviewDrawerPlaceholderView";
import { useLazyPanelMount } from "./useLazyPanelMount";

/** Lazy preview drawer component (module-level so its identity is stable). */
const PreviewDrawer = previewDrawerPanel.Component;
/** Lazy environment sheet component. */
const EnvironmentSheet = environmentSheetPanel.Component;
/** Lazy settings drawer component. */
const SettingsPanel = settingsPanel.Component;

/**
 * Props of the settings drawer (open / onClose). Derived from the widget —
 * it declares them inline — via a type-only import, which emits no runtime
 * import and so keeps the drawer out of the startup chunk.
 */
export type LazySettingsPanelWidgetProps = ComponentProps<
  typeof SettingsPanelWidget
>;

/**
 * Code-split PreviewDrawerWidget (always mounted once its chunk is ready).
 * @param props Same props as PreviewDrawerWidget.
 * @returns The real drawer, or the loading frame while open and not ready.
 */
export function LazyPreviewDrawerWidget(props: PreviewDrawerWidgetProps) {
  const mounted = useLazyPanelMount(previewDrawerPanel, props.open);
  /** Committed width so the placeholder occupies the drawer's exact footprint. */
  const width = usePreviewStore((s) => s.width);
  const placeholder = props.open ? (
    <PreviewDrawerPlaceholderView
      width={width}
      overlay={props.effectiveLayout === "overlay"}
    />
  ) : null;

  return (
    <Suspense fallback={placeholder}>
      {mounted ? <PreviewDrawer {...props} /> : placeholder}
    </Suspense>
  );
}

/**
 * Code-split EnvironmentSheetWidget (+ Rules & prompts page).
 * @param props Same props as EnvironmentSheetWidget.
 * @returns The real sheet once ready; nothing before (overlay, no layout).
 */
export function LazyEnvironmentSheetWidget(props: EnvironmentSheetWidgetProps) {
  const mounted = useLazyPanelMount(environmentSheetPanel, props.open);
  return (
    <Suspense fallback={null}>
      {mounted ? <EnvironmentSheet {...props} /> : null}
    </Suspense>
  );
}

/**
 * Code-split SettingsPanelWidget; also prefetches on the ⌘ / Ctrl modifier
 * so ⌘, finds the chunk loaded.
 * @param props Same props as SettingsPanelWidget.
 * @returns The real drawer once ready; nothing before (overlay, no layout).
 */
export function LazySettingsPanelWidget(props: LazySettingsPanelWidgetProps) {
  const mounted = useLazyPanelMount(settingsPanel, props.open, {
    shortcutIntent: true,
  });
  return (
    <Suspense fallback={null}>
      {mounted ? <SettingsPanel {...props} /> : null}
    </Suspense>
  );
}
