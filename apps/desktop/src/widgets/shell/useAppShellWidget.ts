/**
 * Shell chrome state: exclusive drawers, context rail, palette, rail overlay,
 * theme, confirm dialogs, and the three-tier column layout (dock left,
 * collapse left when the right rail would crush the main minimum, overlay
 * the right rail when even that is too tight). The user can also hide the
 * left rail via the header collapse control — that pref outranks viewport dock.
 * Lifecycle + keyboard live in sibling hooks.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadContextDrawerPrefs,
  saveContextDrawerPrefs,
  type DrawerLayout,
} from "../../lib/contextDrawerPrefs";
import { resolveShellLayout } from "../../lib/shellLayout";
import {
  countRunningSubagents,
  mergeSubagentsWithSpawnTools,
} from "../../lib/agentCards";
import { loadTheme, type ThemeId } from "../../lib/theme";
import { useAgentsPanelStore } from "../../store/agentsPanelStore";
import { usePreviewStore } from "../../store/previewStore";
import { useSessionStore } from "../../store/sessionStore";
import {
  contextRailAfterSessionChange,
  contextRailHasContent,
  contextRailWidthPx,
  shouldAutoOpenPlanRail,
  toggleContextRail,
  toggleExclusivePanel,
  type ContextRailId,
  type EnvironmentPageId,
  type PanelId,
} from "./shellPanels";
import { useShellChromeEvents } from "./useShellChromeEvents";
import { useShellSessionLifecycle } from "./useShellSessionLifecycle";
import { useSidebarVisibility } from "./useSidebarVisibility";

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
  const agentsWidth = useAgentsPanelStore((s) => s.width);
  const resetAgentsForSession = useAgentsPanelStore((s) => s.resetForSession);

  /** User closed context rail this session — blocks plan auto-open. */
  const userClosedRail = useRef(false);
  const lastSessionId = useRef<string | null>(null);
  /** Previous right-rail id so we can detect an open edge (null → open). */
  const previousContextRail = useRef<ContextRailId | null>(null);

  const [activePanel, setActivePanel] = useState<PanelId | null>(null);
  /** Deep-link page for the Environment sheet (reset on close not required). */
  const [environmentPage, setEnvironmentPage] =
    useState<EnvironmentPageId>("overview");
  const [contextRail, setContextRail] = useState<ContextRailId | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [confirm, setConfirm] = useState<ShellConfirm | null>(null);
  /** Stored layout preference (not the clamped effective layout). */
  const [drawerLayoutPref, setDrawerLayoutPref] = useState<DrawerLayout>(
    () => loadContextDrawerPrefs().layout,
  );
  /**
   * Live window width. Seeds from `innerWidth` when available; a resize
   * listener keeps the three-tier layout (dock / collapse left / overlay)
   * in sync with the open rail's actual pixel width.
   */
  const [viewportWidth, setViewportWidth] = useState(() => {
    if (typeof window === "undefined") {
      return 1440;
    }
    return window.innerWidth;
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
    setEnvironmentPage,
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

  /**
   * On session switch (new chat or catalog pick): close plan/agents by default,
   * reset Agents inspect focus to roster, and clear the "user dismissed rail"
   * latch so a later plan arrival can auto-open again in the new session.
   * Rail close skips the initial mount (previous id is null) so we do not
   * thrash state before first paint.
   */
  useEffect(() => {
    if (session.id === lastSessionId.current) {
      return;
    }
    const previousId = lastSessionId.current;
    lastSessionId.current = session.id;
    userClosedRail.current = false;
    resetAgentsForSession(session.id || null);
    if (previousId !== null) {
      setContextRail((rail) => contextRailAfterSessionChange(rail));
    }
  }, [session.id, resetAgentsForSession]);

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
    if (typeof window === "undefined") {
      return;
    }
    const apply = () => setViewportWidth(window.innerWidth);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const live = connectionMode === "live-bridge";
  const title =
    selectedCatalogTitle ||
    (session.timeline.length > 0 ? "Current chat" : "New chat");
  const authOk = environment?.ok !== false;
  const envKnown = environment !== null;
  const planCount = session.plan?.length ?? 0;
  /**
   * Running subagents in the *current* session — rail badge source.
   * Deliberately not poolEntries: that counts other chats' streams and was
   * the bug behind the old workspace Tasks badge.
   */
  const runningSubagents = countRunningSubagents(
    mergeSubagentsWithSpawnTools(session.subagents, session.toolCalls),
  );
  const syncLabel = syncChipLabel({ live, status: session.status });
  const contextRailOpen =
    contextRail === "plan" ||
    contextRail === "preview" ||
    contextRail === "agents";
  const planRailOpen = contextRail === "plan";
  const agentsRailOpen = contextRail === "agents";
  const previewRailOpen = contextRail === "preview";
  const railWidthPx = contextRailWidthPx(
    contextRail,
    previewWidth,
    agentsWidth,
  );
  /**
   * Three-tier chrome: dock left, collapse left when the right rail would
   * crush the main minimum, then overlay the right rail if still short.
   * Empty Plan/Agents still count as open so the clamp sees the same width
   * the push padding would reserve.
   */
  const shellLayout = resolveShellLayout({
    viewportWidth,
    rightRailOpen: contextRailHasContent(contextRail),
    rightRailWidth: railWidthPx,
    drawerPref: drawerLayoutPref,
  });
  const drawerEffectiveLayout = shellLayout.drawerLayout;
  const {
    railOpen,
    setRailOpen,
    sidebarDocked,
    collapseSidebar,
    toggleRail,
  } = useSidebarVisibility({ layoutCanDock: shellLayout.sidebarDocked });
  const layoutClamped =
    drawerLayoutPref === "push" && drawerEffectiveLayout === "overlay";
  /**
   * Push whenever the companion is open and layout allows it — empty Plan /
   * Agents still reserve main-column width so open always squeezes the
   * transcript (contextRailHasContent is open-vs-closed only).
   */
  const pushMode =
    contextRailHasContent(contextRail) && drawerEffectiveLayout === "push";

  const togglePanel = useCallback((which: PanelId) => {
    setActivePanel((p) => toggleExclusivePanel(p, which));
  }, []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const toggleContext = useCallback(() => {
    setContextRail((rail) => {
      // Prefer reopening the last non-preview surface; default plan.
      const target: ContextRailId =
        rail === "agents" || rail === "plan" ? rail : "plan";
      const next = toggleContextRail(rail === "preview" ? null : rail, target);
      if (next === null) {
        userClosedRail.current = true;
      }
      if (next === "plan" || next === "agents") {
        closePreview();
      }
      return next;
    });
  }, [closePreview]);
  const selectContextTab = useCallback(
    (next: "plan" | "agents") => {
      closePreview();
      setContextRail(next);
    },
    [closePreview],
  );
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

  /**
   * Opening the right companion while the left cannot stay docked is the
   * "squeeze the sidebar closed" gesture — dismiss an already-open hamburger
   * overlay so the transcript is not covered by both rails at once.
   * Only runs when the rail *opens* so the user can still hamburger-open
   * sessions while a right rail is already showing.
   */
  useEffect(() => {
    const openedRight =
      previousContextRail.current === null && contextRail !== null;
    previousContextRail.current = contextRail;
    if (openedRight && !sidebarDocked) {
      setRailOpen(false);
    }
  }, [contextRail, setRailOpen, sidebarDocked]);

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
    runningSubagents,
    activePanel,
    environmentPage,
    contextRail,
    contextRailOpen,
    planRailOpen,
    agentsRailOpen,
    previewRailOpen,
    railWidthPx,
    paletteOpen,
    setPaletteOpen,
    railOpen,
    setRailOpen,
    sidebarDocked,
    collapseSidebar,
    toggleRail,
    theme,
    setTheme,
    confirm,
    togglePanel,
    closePanel,
    toggleContext,
    selectContextTab,
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
