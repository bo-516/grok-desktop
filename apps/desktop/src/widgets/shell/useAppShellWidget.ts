/**
 * Shell chrome state: exclusive drawers, context rail, palette, rail overlay,
 * theme, confirm dialogs, and context-drawer layout prefs.
 * Lifecycle + keyboard live in sibling hooks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAWER_PUSH_MIN_WIDTH,
  effectiveDrawerLayout,
  loadContextDrawerPrefs,
  saveContextDrawerPrefs,
  type DrawerLayout,
} from "../../lib/contextDrawerPrefs";
import { loadTheme, type ThemeId } from "../../lib/theme";
import { usePreviewStore } from "../../store/previewStore";
import { useSessionStore } from "../../store/sessionStore";
import {
  contextRailWidthPx,
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
  /**
   * Current header title only; background catalog text growth must stay below
   * the App render boundary. A missing match falls back after subscriptions.
   */
  const selectedCatalogTitle = useSessionStore(
    (s) => s.catalog.find((entry) => entry.id === s.session.id)?.title,
  );
  const environment = useSessionStore((s) => s.environment);
  /**
   * Streaming count is the shell's only pool dependency. Returning a primitive
   * keeps background pool broadcasts with the same count from re-rendering App
   * and its timeline; subscribing to the full array would repaint on every
   * concurrent session chunk even though the shell output was unchanged.
   */
  const liveCount = useSessionStore(
    (s) =>
      s.poolEntries.filter(
        (entry) => entry.live && entry.status === "streaming",
      ).length,
  );
  const restartNotice = useSessionStore((s) => s.restartNotice);
  const clearRestartNotice = useSessionStore((s) => s.clearRestartNotice);
  const removeSession = useSessionStore((s) => s.removeSession);
  const runCli = useSessionStore((s) => s.runCli);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const newSession = useSessionStore((s) => s.newSession);
  const promptQueue = useSessionStore((s) => s.promptQueue);
  const viewingSessionId = useSessionStore((s) => s.viewingSessionId);
  const sessionId = useSessionStore((s) => s.session.id);
  const previewTarget = usePreviewStore((s) => s.target);
  const previewWidth = usePreviewStore((s) => s.width);
  const closePreview = usePreviewStore((s) => s.closePreview);

  /** User closed context rail this session — blocks plan auto-open. */
  const userClosedRail = useRef(false);
  const lastSessionId = useRef<string | null>(null);

  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  const [contextRail, setContextRail] = useState<ContextRailId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [confirm, setConfirm] = useState<ShellConfirm | null>(null);
  /** Stored layout preference (not the clamped effective layout). */
  const [drawerLayoutPref, setDrawerLayoutPref] = useState<DrawerLayout>(
    () => loadContextDrawerPrefs().layout,
  );
  /**
   * True when viewport width is at or above the push min-width.
   * Seeds from window when available; matchMedia keeps it live.
   */
  const [viewportAllowsPush, setViewportAllowsPush] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return window.innerWidth >= DRAWER_PUSH_MIN_WIDTH;
  });

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

  const canvasQueueId = sessionId.trim() || viewingSessionId?.trim() || "";
  const canvasQueueLength = canvasQueueId
    ? promptQueue.filter((item) => item.sessionId === canvasQueueId).length
    : 0;

  useShellSessionLifecycle({
    status: session.status,
    title: session.title,
    sessionId: session.id,
    queueLength: canvasQueueLength,
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

  // When a preview target is set, open the preview rail (mutual with plan).
  useEffect(() => {
    if (previewTarget) {
      setContextRail("preview");
    }
  }, [previewTarget]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(`(min-width: ${DRAWER_PUSH_MIN_WIDTH}px)`);
    const apply = () => setViewportAllowsPush(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const live = connectionMode === "live-bridge";
  const title =
    selectedCatalogTitle ||
    (session.timeline.length > 0 ? "Current chat" : "New chat");
  const authOk = environment?.ok !== false;
  const envKnown = environment !== null;
  const planCount = session.plan?.length ?? 0;
  const syncLabel = syncChipLabel({ live, status: session.status });
  const viewportWidth = viewportAllowsPush
    ? DRAWER_PUSH_MIN_WIDTH
    : DRAWER_PUSH_MIN_WIDTH - 1;
  const drawerEffectiveLayout = effectiveDrawerLayout(
    drawerLayoutPref,
    viewportWidth,
  );
  const layoutClamped =
    drawerLayoutPref === "push" && drawerEffectiveLayout === "overlay";
  const contextRailOpen = contextRail === "plan" || contextRail === "preview";
  const planRailOpen = contextRail === "plan";
  const previewRailOpen = contextRail === "preview";
  /**
   * Push only when the open rail has real content. An empty Plan (or empty
   * Preview) uses overlay so the transcript is not squeezed for "No plan yet".
   */
  const railHasContent =
    (planRailOpen && planCount > 0) ||
    (previewRailOpen && previewTarget != null);
  const pushMode =
    contextRailOpen &&
    railHasContent &&
    drawerEffectiveLayout === "push";
  const railWidthPx = contextRailWidthPx(contextRail, previewWidth);

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
      if (next === "plan") {
        closePreview();
      }
      return next;
    });
  }, [closePreview]);
  const closeContextRail = useCallback(() => {
    userClosedRail.current = true;
    closePreview();
    setContextRail(null);
  }, [closePreview]);
  const requestDelete = useCallback((id: string, sessionTitle: string) => {
    setConfirm({ kind: "session_delete", id, title: sessionTitle });
  }, []);
  const clearConfirm = useCallback(() => setConfirm(null), []);
  const setDrawerLayout = useCallback((layout: DrawerLayout) => {
    setDrawerLayoutPref(layout);
    saveContextDrawerPrefs({ layout });
  }, []);

  return {
    session,
    viewingSessionId,
    environment,
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
    contextRailOpen,
    planRailOpen,
    previewRailOpen,
    railWidthPx,
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
    drawerLayoutPref,
    drawerEffectiveLayout,
    layoutClamped,
    pushMode,
    setDrawerLayout,
  };
}

/**
 * Compact top-bar sync label (Synced / Offline / Awaiting).
 *
 * Connection state only. Turn activity moved to the live strip above the
 * composer (TurnStatusWidget) — a "Generating" word in the far corner was the
 * weakest possible place to report it, and duplicating it here would make the
 * two indicators disagree the moment one lags behind the other.
 *
 * @param args Live flag and session status.
 */
function syncChipLabel(args: { live: boolean; status: string }): string {
  if (!args.live) {
    return "Offline";
  }
  if (args.status === "waiting_permission") {
    return "Awaiting";
  }
  return "Synced";
}
