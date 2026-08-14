/**
 * Left session-rail visibility: overlay open flag + persisted user collapse.
 * Viewport dock math stays in resolveShellLayout; this hook applies the
 * user's hide choice and exposes collapse / hamburger handlers.
 */

import { useCallback, useEffect, useState } from "react";
import {
  isSidebarDocked,
  loadSidebarPrefs,
  saveSidebarPrefs,
  sidebarCollapseAction,
  sidebarToggleAction,
} from "../../lib/sidebarPrefs";

export type UseSidebarVisibilityArgs = {
  /**
   * Viewport would dock the rail if the user had not collapsed it.
   * From `resolveShellLayout().sidebarDocked`.
   */
  layoutCanDock: boolean;
};

export type UseSidebarVisibilityResult = {
  /** Overlay open flag. Ignored while the rail occupies layout space. */
  railOpen: boolean;
  /** Set overlay open. Backdrop / session pick call this with false. */
  setRailOpen: (open: boolean) => void;
  /**
   * Rail occupies layout space. False when the viewport is too tight OR
   * the user hid it — both cases flush the main column and show the hamburger.
   */
  sidebarDocked: boolean;
  /** Header collapse next to "Grok": persist hide when docked, else close overlay. */
  collapseSidebar: () => void;
  /** Top-nav hamburger: re-dock a hidden rail that still fits, else toggle overlay. */
  toggleRail: () => void;
};

/**
 * Own overlay + collapse state for the left session rail.
 * @param args Viewport dock flag from the shell layout clamp.
 * @returns Effective dock, overlay flag, and hide/reopen handlers.
 */
export function useSidebarVisibility(
  args: UseSidebarVisibilityArgs,
): UseSidebarVisibilityResult {
  const { layoutCanDock } = args;
  const [railOpen, setRailOpen] = useState(false);
  /**
   * User hid the left rail (header collapse). Survives remount / refresh so a
   * wide window does not force the list back open after they tucked it away.
   */
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => loadSidebarPrefs().collapsed,
  );
  const sidebarDocked = isSidebarDocked(layoutCanDock, sidebarCollapsed);

  /**
   * Write the hide choice to state + localStorage.
   * @param collapsed True hides the rail until the user reopens it.
   */
  const commitSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    saveSidebarPrefs({ collapsed });
  }, []);

  /**
   * Header collapse (always-visible control next to "Grok").
   * Docked: persist hide so the main column goes flush. Overlay: just close.
   */
  const collapseSidebar = useCallback(() => {
    if (
      sidebarCollapseAction({
        layoutCanDock,
        userCollapsed: sidebarCollapsed,
      }) === "persist-collapse"
    ) {
      commitSidebarCollapsed(true);
    }
    setRailOpen(false);
  }, [commitSidebarCollapsed, layoutCanDock, sidebarCollapsed]);

  /**
   * Top-nav hamburger. Re-docks a user-hidden rail that still fits; otherwise
   * toggles the off-canvas overlay (narrow viewport).
   */
  const toggleRail = useCallback(() => {
    if (
      sidebarToggleAction({
        layoutCanDock,
        userCollapsed: sidebarCollapsed,
      }) === "re-dock"
    ) {
      commitSidebarCollapsed(false);
      setRailOpen(false);
      return;
    }
    setRailOpen((open) => !open);
  }, [commitSidebarCollapsed, layoutCanDock, sidebarCollapsed]);

  /**
   * Docked rail does not use the hamburger flag. Clear it so a leftover
   * overlay-open state cannot flash a backdrop after a widen or re-dock.
   */
  useEffect(() => {
    if (sidebarDocked) {
      setRailOpen(false);
    }
  }, [sidebarDocked]);

  return {
    railOpen,
    setRailOpen,
    sidebarDocked,
    collapseSidebar,
    toggleRail,
  };
}
