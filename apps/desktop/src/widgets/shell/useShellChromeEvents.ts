/**
 * Global shell keyboard shortcuts and custom-event listeners.
 * Kept separate from useAppShellWidget so the hook file stays under line budget.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";
import {
  openExclusivePanel,
  toggleContextRail,
  type ContextRailId,
  type PanelId,
} from "./shellPanels";

export type ShellChromeEventsArgs = {
  /** Exclusive panel setter. */
  setActivePanel: Dispatch<SetStateAction<PanelId | null>>;
  /** Context rail setter; caller wires userClosedRail on close. */
  setContextRail: Dispatch<SetStateAction<ContextRailId | null>>;
  /** Called when the user closes the context rail (manual dismiss). */
  onUserCloseContextRail: () => void;
  /** Palette open setter. */
  setPaletteOpen: Dispatch<SetStateAction<boolean>>;
  /** Open rewind confirm. */
  onRequestRewind: () => void;
  /** Create a new session (⌘N). */
  onNewSession: () => void;
};

/**
 * Register ⌘K / ⌘N / ⌘, / ⌘\ and open-panel / open-rewind / open-palette events.
 * @param args Setters and callbacks from the shell hook.
 */
export function useShellChromeEvents(args: ShellChromeEventsArgs): void {
  const {
    setActivePanel,
    setContextRail,
    onUserCloseContextRail,
    setPaletteOpen,
    onRequestRewind,
    onNewSession,
  } = args;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (meta && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onNewSession();
        return;
      }
      if (meta && e.key === ",") {
        e.preventDefault();
        setActivePanel((p) => openExclusivePanel(p, "settings"));
        return;
      }
      if (meta && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        setContextRail((rail) => {
          const next = toggleContextRail(rail, "plan");
          if (next === null) {
            onUserCloseContextRail();
          }
          return next;
        });
      }
    };
    const onPanel = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (
        detail === "extensions" ||
        detail === "settings" ||
        detail === "overview" ||
        detail === "tasks"
      ) {
        setActivePanel(openExclusivePanel(null, detail));
      }
    };
    const onRewind = () => {
      onRequestRewind();
    };
    const onPalette = () => {
      setPaletteOpen(true);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("grok-desktop:open-panel", onPanel);
    window.addEventListener("grok-desktop:open-rewind", onRewind);
    window.addEventListener("grok-desktop:open-palette", onPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("grok-desktop:open-panel", onPanel);
      window.removeEventListener("grok-desktop:open-rewind", onRewind);
      window.removeEventListener("grok-desktop:open-palette", onPalette);
    };
  }, [
    setActivePanel,
    setContextRail,
    onUserCloseContextRail,
    setPaletteOpen,
    onRequestRewind,
    onNewSession,
  ]);
}
