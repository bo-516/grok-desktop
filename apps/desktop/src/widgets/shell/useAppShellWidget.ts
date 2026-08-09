/**
 * Shell chrome state: exclusive drawers, context rail, palette, rail overlay,
 * theme, confirm dialogs. Lifecycle + keyboard live in sibling hooks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../../store/sessionStore";
import { loadTheme, type ThemeId } from "../../lib/theme";
import {
  shouldAutoOpenPlanRail,
  toggleContextRail,
  toggleExclusivePanel,
  type ContextRailId,
  type PanelId,
} from "./shellPanels";
import { useShellChromeEvents } from "./useShellChromeEvents";
import { useShellSessionLifecycle } from "./useShellSessionLifecycle";

/** Confirm dialog kinds hosted by the shell (single active confirm). */
export type ShellConfirm =
  | { kind: "session_delete"; id: string; title: string }
  | { kind: "rewind" };

/**
 * Assembles shell UI state for App region assembly.
 * @returns Flags, labels, and handlers for top-nav, rails, drawers, and confirms.
 */
export function useAppShellWidget() {
  const session = useSessionStore((s) => s.session);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const catalog = useSessionStore((s) => s.catalog);
  const environment = useSessionStore((s) => s.environment);
  const poolEntries = useSessionStore((s) => s.poolEntries);
  const restartNotice = useSessionStore((s) => s.restartNotice);
  const clearRestartNotice = useSessionStore((s) => s.clearRestartNotice);
  const removeSession = useSessionStore((s) => s.removeSession);
  const runCli = useSessionStore((s) => s.runCli);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const newSession = useSessionStore((s) => s.newSession);
  const promptQueue = useSessionStore((s) => s.promptQueue);

  /** User closed context rail this session — blocks plan auto-open. */
  const userClosedRail = useRef(false);
  const lastSessionId = useRef<string | null>(null);

  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [contextRail, setContextRail] = useState<ContextRailId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [confirm, setConfirm] = useState<ShellConfirm | null>(null);

  const markUserClosedRail = useCallback(() => {
    userClosedRail.current = true;
  }, []);

  const requestRewind = useCallback(() => {
    setConfirm({ kind: "rewind" });
  }, []);

  const onNewSession = useCallback(() => {
    void newSession();
  }, [newSession]);

  useShellChromeEvents({
    setActivePanel,
    setContextRail,
    onUserCloseContextRail: markUserClosedRail,
    setPaletteOpen,
    onRequestRewind: requestRewind,
    onNewSession,
  });

  useShellSessionLifecycle({
    status: session.status,
    title: session.title,
    sessionId: session.id,
    queueLength: promptQueue.length,
    connectionMode,
  });

  useEffect(() => {
    const onTheme = (e: Event) => {
      setTheme((e as CustomEvent<ThemeId>).detail);
    };
    window.addEventListener("grok-desktop:theme-changed", onTheme);
    return () =>
      window.removeEventListener("grok-desktop:theme-changed", onTheme);
  }, []);

  useEffect(() => {
    if (session.id !== lastSessionId.current) {
      lastSessionId.current = session.id;
      userClosedRail.current = false;
    }
  }, [session.id]);

  useEffect(() => {
    const planLength = session.plan?.length ?? 0;
    if (
      shouldAutoOpenPlanRail(planLength, contextRail, userClosedRail.current)
    ) {
      setContextRail("plan");
    }
  }, [session.plan, contextRail]);

  const live = connectionMode === "live-bridge";
  const title =
    catalog.find((c) => c.id === session.id)?.title ||
    (session.timeline.length > 0 ? "Current chat" : "New chat");
  const liveCount = poolEntries.filter((e) => e.live).length;
  const authOk = environment?.ok !== false;
  const envKnown = environment !== null;
  const planCount = session.plan?.length ?? 0;
  const syncLabel = syncChipLabel({ live, status: session.status });

  const togglePanel = useCallback((which: PanelId) => {
    setActivePanel((p) => toggleExclusivePanel(p, which));
  }, []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const toggleContext = useCallback(() => {
    setContextRail((rail) => {
      const next = toggleContextRail(rail, "plan");
      if (next === null) {
        userClosedRail.current = true;
      }
      return next;
    });
  }, []);
  const closeContextRail = useCallback(() => {
    userClosedRail.current = true;
    setContextRail(null);
  }, []);
  const requestDelete = useCallback((id: string, sessionTitle: string) => {
    setConfirm({ kind: "session_delete", id, title: sessionTitle });
  }, []);
  const clearConfirm = useCallback(() => setConfirm(null), []);

  return {
    session,
    catalog,
    environment,
    poolEntries,
    restartNotice,
    clearRestartNotice,
    removeSession,
    runCli,
    sendPrompt,
    promptQueue,
    live,
    title,
    liveCount,
    authOk,
    envKnown,
    syncLabel,
    planCount,
    activePanel,
    contextRail,
    paletteOpen,
    setPaletteOpen,
    railOpen,
    setRailOpen,
    theme,
    setTheme,
    confirm,
    togglePanel,
    closePanel,
    toggleContext,
    closeContextRail,
    requestDelete,
    requestRewind,
    clearConfirm,
  };
}

/**
 * Compact top-bar sync label (Synced / Generating / Offline / Awaiting).
 * @param args Live flag and session status.
 */
function syncChipLabel(args: { live: boolean; status: string }): string {
  if (!args.live) {
    return "Offline";
  }
  if (args.status === "streaming") {
    return "Generating";
  }
  if (args.status === "waiting_permission") {
    return "Awaiting";
  }
  return "Synced";
}
