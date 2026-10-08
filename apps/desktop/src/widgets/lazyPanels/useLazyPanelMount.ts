/**
 * Decide when a code-split panel joins the React tree.
 *
 * Why not just `{open && <Lazy/>}`: React 19 throttles revealing Suspense
 * content to ≥300 ms after a fallback commits, so a panel that suspends on
 * the click that opens it would visibly stall. Instead:
 *
 * 1. The panel chunk is warmed in an idle slot after first paint (and on
 *    intent, e.g. the ⌘ modifier for ⌘-shortcut panels).
 * 2. Once ready, the panel mounts *closed* in the background — the same
 *    always-mounted state these panels had before code splitting, so open
 *    is instant and open/close transitions are unchanged.
 * 3. The mount flag goes through `useDeferredValue`: if a user opens the
 *    panel before warm-up finished, the deferred render suspends and React
 *    keeps the previous UI (the caller's placeholder) instead of committing
 *    a fallback, so the panel paints as soon as its chunk lands — no
 *    throttle.
 *
 * Boundary: once true the result stays true (ready is sticky), so panel
 * state such as unsaved Settings drafts survives close/reopen as before.
 */

import { useDeferredValue, useEffect, useSyncExternalStore } from "react";
import type { LazyPanelLoader } from "./createLazyPanel";
import { panelWarmupQueue } from "./idleWarmup";

/** Optional intent signals for {@link useLazyPanelMount}. */
export type LazyPanelMountOptions = {
  /**
   * Preload when ⌘ / Ctrl goes down — for panels opened by a ⌘-shortcut
   * (⌘, → Settings). The modifier keydown arrives well before the letter,
   * which is enough time to load a local chunk. Default false.
   */
  shortcutIntent?: boolean;
};

/**
 * Mount gate for a lazily loaded panel.
 * @param panel Loader from createLazyPanel (stable module-level object; a new
 *   object per render would re-subscribe and re-enqueue every render).
 * @param open Whether the shell wants the panel visible now. Opening before
 *   the chunk is ready starts the load; the panel appears once it lands.
 * @param options Intent prefetch switches.
 * @returns true when the lazy component should be rendered (closed or open);
 *   false while the chunk is not ready yet — render the placeholder then.
 */
export function useLazyPanelMount(
  panel: LazyPanelLoader,
  open: boolean,
  options: LazyPanelMountOptions = {},
): boolean {
  const { shortcutIntent = false } = options;
  const ready = useSyncExternalStore(
    panel.subscribe,
    panel.isReady,
    panel.isReady,
  );

  // Queue the chunk for idle warm-up once the shell has mounted.
  useEffect(() => {
    panelWarmupQueue.enqueue(panel.preload);
  }, [panel]);

  // Intent: modifier key down ahead of a ⌘-shortcut. Dropped once ready.
  useEffect(() => {
    if (!shortcutIntent || ready) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Meta" || e.key === "Control") {
        void panel.preload();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel, ready, shortcutIntent]);

  // initialValue false: even an open-at-boot panel mounts via a deferred
  // render, so its first load never commits a throttled Suspense fallback.
  return useDeferredValue(ready || open, false);
}
