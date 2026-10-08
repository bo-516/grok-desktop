/**
 * Entry hook of the terminal dock widget: open state + height (persisted per
 * viewer), the tab list, ⌘J / Ctrl+J, and the bridge calls that create / kill
 * shells. All high-frequency state (drag height, tab titles, exits) stays in
 * this widget; the session store is only read for the live bridge channel and
 * the viewing session's id / workspace (new shells start there).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalExit } from "@/bridge/liveBridgeTerminalTypes";
import { focusComposer } from "@/lib/composerFocus";
import { isMacPlatform, isTerminalToggleChord } from "@/lib/terminalKeys";
import {
  loadTerminalPanelPrefs,
  saveTerminalPanelPrefs,
  type TerminalPanelPrefs,
} from "@/lib/terminalPanelPrefs";
import {
  closeTerminalTab,
  createTerminalTab,
  patchTerminalTab,
  terminalExitDetail,
  type TerminalTab,
  type TerminalTabPatch,
} from "@/lib/terminalTabs";
import { useSessionStore } from "@/store/sessionStore";
import { useTerminalAppearance, type TerminalAppearance } from "./useTerminalAppearance";
import { useTerminalDockResize, type TerminalDockResizeHandlers } from "./useTerminalDockResize";

/** Tabs plus the selected key, updated together so close can pick a neighbour. */
type DockTabs = { tabs: TerminalTab[]; activeKey: string | null };

/** Everything TerminalPanelWidget renders from. */
export type TerminalPanelWidgetModel = {
  /** Dock visible. */
  open: boolean;
  /** Rendered dock height in px (viewport-clamped, live while dragging). */
  height: number;
  /** True while the resize handle is dragged. */
  dragging: boolean;
  /** Handlers for the resize handle. */
  resizeHandlers: TerminalDockResizeHandlers;
  /** Tabs in strip order. */
  tabs: TerminalTab[];
  /** Selected tab key; null when there are no tabs. */
  activeKey: string | null;
  /** False while the bridge is disconnected (no new shells possible). */
  canCreate: boolean;
  /** xterm theme + font from defineColor tokens. */
  appearance: TerminalAppearance;
  /** Start another shell in the viewing session's workspace. */
  newTab: () => void;
  /** Kill (if running) and remove a tab; closing the last tab hides the dock. */
  closeTab: (key: string) => void;
  /** Select a tab. */
  selectTab: (key: string) => void;
  /** Hide the dock (shells keep running) and return focus to the composer. */
  hide: () => void;
  /** xterm host callback: first measured size → create the shell. */
  onReady: (key: string, cols: number, rows: number) => void;
  /** xterm host callback: the shell ended. */
  onExit: (key: string, exit: TerminalExit) => void;
  /** xterm host callback: the shell set its title. */
  onTitle: (key: string, title: string) => void;
};

/**
 * Compose dock state, prefs, keyboard toggle and bridge actions.
 * @returns The dock model; callbacks are stable across renders.
 */
export function useTerminalPanelWidget(): TerminalPanelWidgetModel {
  const api = useSessionStore((s) => s.live?.terminal ?? null);
  const sessionId = useSessionStore((s) => s.viewingSessionId);
  const workspace = useSessionStore((s) => s.session.workspace);
  const appearance = useTerminalAppearance();
  const [prefs, setPrefs] = useState<TerminalPanelPrefs>(loadTerminalPanelPrefs);
  const [dock, setDock] = useState<DockTabs>({ tabs: [], activeKey: null });
  /** Latest values for stable callbacks (read at call time, not render time). */
  const latest = useRef({ api, sessionId, workspace, dock, open: prefs.open });
  /** Monotonic tab key counter. */
  const keySeq = useRef(0);

  useEffect(() => {
    latest.current = { api, sessionId, workspace, dock, open: prefs.open };
  });

  useEffect(() => {
    saveTerminalPanelPrefs(prefs);
  }, [prefs]);

  const commitHeight = useCallback((height: number) => {
    setPrefs((p) => (p.height === height ? p : { ...p, height }));
  }, []);
  const resize = useTerminalDockResize(prefs.height, commitHeight);

  const setOpen = useCallback((open: boolean) => {
    setPrefs((p) => (p.open === open ? p : { ...p, open }));
    if (!open) {
      focusComposer();
    }
  }, []);

  const newTab = useCallback(() => {
    const ctx = latest.current;
    if (!ctx.api) {
      return;
    }
    keySeq.current += 1;
    const tab = createTerminalTab(`tab-${keySeq.current}`, ctx.api, ctx.sessionId, ctx.workspace);
    setDock((d) => ({ tabs: [...d.tabs, tab], activeKey: tab.key }));
  }, []);

  const closeTab = useCallback(
    (key: string) => {
      const { dock: current } = latest.current;
      const tab = current.tabs.find((t) => t.key === key);
      if (tab?.terminalId && tab.status === "running") {
        tab.api.kill(tab.terminalId);
      }
      const next = closeTerminalTab(current.tabs, current.activeKey, key);
      setDock(next);
      if (next.tabs.length === 0) {
        setOpen(false);
      }
    },
    [setOpen],
  );

  const selectTab = useCallback((key: string) => {
    setDock((d) => (d.activeKey === key ? d : { ...d, activeKey: key }));
  }, []);

  const hide = useCallback(() => setOpen(false), [setOpen]);

  const patch = useCallback((key: string, fields: TerminalTabPatch) => {
    setDock((d) => ({ ...d, tabs: patchTerminalTab(d.tabs, key, fields) }));
  }, []);

  const onReady = useCallback(
    (key: string, cols: number, rows: number) => {
      const tab = latest.current.dock.tabs.find((t) => t.key === key);
      if (!tab || tab.terminalId || tab.status !== "starting") {
        return;
      }
      tab.api
        .create({ sessionId: tab.sessionId, cwd: tab.requestedCwd, cols, rows })
        .then((info) => {
          // Closed while starting: do not leak the shell.
          if (!latest.current.dock.tabs.some((t) => t.key === key)) {
            tab.api.kill(info.terminalId);
            return;
          }
          patch(key, { terminalId: info.terminalId, info, status: "running" });
        })
        .catch((error: unknown) => {
          patch(key, {
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [patch],
  );

  const onExit = useCallback(
    (key: string, exit: TerminalExit) => {
      patch(key, { status: "exited", detail: terminalExitDetail(exit) });
    },
    [patch],
  );

  const onTitle = useCallback(
    (key: string, title: string) => patch(key, { title }),
    [patch],
  );

  // ⌘J (macOS) / Ctrl+J: show / hide. xterm passes the chord through
  // (attachCustomKeyEventHandler), so this works with a terminal focused.
  useEffect(() => {
    const mac = isMacPlatform(navigator);
    const onKey = (e: KeyboardEvent) => {
      if (!isTerminalToggleChord(e, mac)) {
        return;
      }
      e.preventDefault();
      setOpen(!latest.current.open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // An open dock with no tabs (first ⌘J, restored prefs, reconnect) gets a shell.
  useEffect(() => {
    if (prefs.open && api && dock.tabs.length === 0) {
      newTab();
    }
  }, [prefs.open, api, dock.tabs.length, newTab]);

  return {
    open: prefs.open,
    height: resize.height,
    dragging: resize.dragging,
    resizeHandlers: resize.handlers,
    tabs: dock.tabs,
    activeKey: dock.activeKey,
    canCreate: api !== null,
    appearance,
    newTab,
    closeTab,
    selectTab,
    hide,
    onReady,
    onExit,
    onTitle,
  };
}
