/**
 * Session store actions: new/select/remove/workspace/reconnect/disconnect.
 * Wired into useSessionStore; no React.
 */

import { createSessionState, markDisconnected } from "@grok-desktop/acp-core";
import { focusComposer } from "@/lib/composerFocus";
import { withCachedSlashCatalog } from "@/lib/slashCatalog";
import { isSubagentSessionKind } from "@/lib/sessionActions";
import { sessionHasConversationContent } from "@/lib/sessionContent";
import {
  loadWorkspacePrefs,
  rememberAndActivateWorkspace,
  saveWorkspacePrefs,
  setActiveWorkspacePrefs,
} from "@/lib/workspacePrefs";
import {
  normalizeCatalog,
  recordToSessionState,
  upsertFromLiveState,
} from "./sessionCatalog";
import {
  cancelPendingSessionsSync,
  DEFAULT_ALWAYS_APPROVE,
  flushPendingSessionsToCatalog,
  startLiveBridgeSession,
  stopPoolPoll,
} from "./sessionStoreLive";
import { flushChildSessionsToCatalog } from "./sessionRoles";
import { stampProvenance } from "./sessionProvenance";
import { hydrateViewingSessionFromDisk } from "./sessionStoreHistory";
import { promoteBufferedChildForSelect } from "./sessionStoreSelectPromote";
import {
  flushCatalogPersist,
  INITIAL_SESSION,
  persistCatalog,
  persistNormalizedCatalog,
  resolveResumeTarget,
} from "./sessionStoreSupport";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
  SetWorkspaceResult,
} from "./sessionStoreTypes";
import { forgetAllTurnEdges, forgetTurnEdge } from "./sessionTurnEdge";

/** Selection sequence while async resume is in flight (stale async guards). */
let selectSeq = 0;

/** Bump select sequence (tests / cancel in-flight select). @returns New seq. */
export function bumpSelectSeq(): number {
  selectSeq += 1;
  return selectSeq;
}

/**
 * Open a local New chat draft. Does **not** call session/new on the bridge;
 * the real session is created on the first successful sendPrompt (forceNew).
 * Optional cwd overrides workspace prefs for the draft and later create.
 * After the canvas is blanked, asks the composer to take keyboard focus so
 * every entry (rail, ⌘N, palette, session ⋯, workspace switch) lands in the
 * input — the ⋯ menu and New chat button would otherwise keep focus.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param cwd Absolute path, empty for no project, or omit for prefs/session.
 */
export async function newSessionAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  cwd?: string,
): Promise<void> {
  const prefs = loadWorkspacePrefs();
  // Explicit arg (including "") wins. Otherwise prefer prefs (noProject → "")
  // so bridge default cwd on session.workspace cannot hijack New chat.
  let workspace: string;
  if (cwd !== undefined) {
    workspace = cwd.trim();
  } else if (prefs.noProject) {
    workspace = "";
  } else {
    workspace =
      prefs.activeWorkspace.trim() || get().session.workspace.trim();
  }
  if (workspace) {
    saveWorkspacePrefs(rememberAndActivateWorkspace(prefs, workspace));
  } else if (cwd !== undefined || prefs.noProject) {
    // Explicit no-project (caller or prefs) — keep the flag sticky.
    saveWorkspacePrefs(setActiveWorkspacePrefs(prefs, ""));
  }
  // Cancel in-flight select/resume so a late resume cannot repaint over the draft.
  selectSeq += 1;
  get().clearPendingMode();
  const prev = get().session;
  /**
   * Keep the last grok-build slash catalog on the draft. Handshake is deferred
   * until first send; `/` must still list compact / skills immediately.
   */
  const draftSession = withCachedSlashCatalog({
    ...createSessionState({
      id: "",
      workspace,
      mode: prev.mode,
    }),
    availableCommands: prev.availableCommands,
  });
  // Persist the previous live canvas into the rail before blanking the UI.
  // No bridge spawn here — avoids empty "Chat xxxx" ghosts until the user sends.
  if (prev.id) {
    const catalog = normalizeCatalog(
      upsertFromLiveState(get().catalog, prev),
    );
    persistNormalizedCatalog(catalog);
    flushCatalogPersist();
    set({
      catalog,
      viewingSessionId: null,
      activeSessionId: null,
      lastError: null,
      localDraft: true,
      creatingSession: false,
      restoringSessionId: null,
      viewingSubagent: false,
      viewingParentSessionId: undefined,
      bridgeInfo: "New chat — send a message to start",
      session: draftSession,
    });
    focusComposer();
    return;
  }
  set({
    viewingSessionId: null,
    activeSessionId: null,
    lastError: null,
    localDraft: true,
    creatingSession: false,
    viewingSubagent: false,
    viewingParentSessionId: undefined,
    bridgeInfo: "New chat — send a message to start",
    session: draftSession,
  });
  focusComposer();
}

/**
 * Switch empty draft workspace (or New chat when path changes).
 * @param set Zustand set.
 * @param get Zustand get.
 * @param cwd Absolute path or empty/null for no project.
 * @returns ok, or locked when the open session already has conversation content.
 */
export async function setWorkspaceAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  cwd: string | null,
): Promise<SetWorkspaceResult> {
  if (sessionHasConversationContent(get().session.timeline)) {
    return { ok: false, reason: "locked" };
  }
  const path = (cwd ?? "").trim();
  const prefs = loadWorkspacePrefs();
  saveWorkspacePrefs(
    path
      ? rememberAndActivateWorkspace(prefs, path)
      : setActiveWorkspacePrefs(prefs, ""),
  );
  // Same folder already open on an empty draft — prefs updated, no restart.
  if (path === get().session.workspace.trim()) {
    return { ok: true };
  }
  await newSessionAction(set, get, path);
  return { ok: true };
}

/**
 * Reconnect using resume target (session/load when possible).
 * @param set Zustand set.
 * @param get Zustand get.
 */
export async function reconnectAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): Promise<void> {
  const target = resolveResumeTarget(get(), {});
  await startLiveBridgeSession(set, get, {
    alwaysApprove: DEFAULT_ALWAYS_APPROVE,
    cwd: target.cwd,
    resumeId: target.resumeId,
    seed: target.seed,
    forceNew: !target.resumeId,
  });
}

/**
 * Focus a catalog session: seed canvas immediately, resume live when needed.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param id Catalog / ACP session id.
 */
export function selectSessionAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  id: string,
): void {
  // L3 drill-down: promote buffered (or role-only stub) child → catalog first.
  promoteBufferedChildForSelect(set, get, id);

  const rec = get().catalog.find((s) => s.id === id);
  if (!rec) {
    return;
  }

  const seq = ++selectSeq;
  const poolEntry = get().poolEntries.find((e) => e.sessionId === id && e.live);
  const seeded = recordToSessionState(rec, poolEntry?.status);
  const inPool = Boolean(poolEntry);
  /**
   * Nothing cached to paint: session/load replay is silent until it finishes,
   * so the canvas needs a restore hint instead of the New chat empty state.
   * Disk hydrate (chat_history.jsonl) usually clears this in tens of ms;
   * in-pool sessions can still be empty (Go never holds timeline).
   */
  const coldRestore = seeded.timeline.length === 0;

  // Mode switch timers / pending belong to the previous canvas only.
  get().clearPendingMode();
  // Session switch: force any pending catalog write so the prior chat is durable.
  flushCatalogPersist();

  // Role may land from live index before disk session_kind sync (I2).
  const kind = rec.sessionKind ?? get().sessionRoles[id]?.sessionKind;
  const parentId =
    rec.parentSessionId ?? get().sessionRoles[id]?.parentSessionId;

  // Local fact: this client requested the session — user-facing whitelist.
  const sessionProvenance = stampProvenance(
    get().sessionProvenance,
    id,
    isSubagentSessionKind(kind) ? "child" : "resumed",
  );

  set({
    viewingSessionId: id,
    session: withCachedSlashCatalog(seeded),
    lastError: null,
    localDraft: false,
    creatingSession: false,
    restoringSessionId: coldRestore ? id : null,
    bridgeInfo: inPool ? `live · ${rec.title}` : `Opened · ${rec.title}`,
    // Store-derived readonly mode: one place, many consumers (composer / top-nav).
    viewingSubagent: isSubagentSessionKind(kind),
    viewingParentSessionId: parentId,
    sessionProvenance,
  });

  // Paint from ~/.grok/sessions while spawn / session/load runs in the background.
  if (coldRestore) {
    void hydrateViewingSessionFromDisk(set, get, {
      sessionId: id,
      cwd: rec.workspace || undefined,
      guard: () => seq === selectSeq,
    });
  }

  // Already in pool or current live focus: only run start hit-path / push state.
  if (
    get().connectionMode === "live-bridge" &&
    get().live &&
    (inPool || id === get().activeSessionId)
  ) {
    get().live?.start({
      resumeId: id,
      cwd: rec.workspace || undefined,
      alwaysApprove: DEFAULT_ALWAYS_APPROVE,
      seed: seeded,
    });
    return;
  }

  void (async () => {
    try {
      await startLiveBridgeSession(set, get, {
        alwaysApprove: DEFAULT_ALWAYS_APPROVE,
        cwd: rec.workspace || undefined,
        resumeId: id,
        seed: seeded,
        // Skip post-await canvas writes when a later select superseded us.
        guard: () => seq === selectSeq,
      });
      if (seq !== selectSeq) {
        return;
      }
      set({ bridgeInfo: `live · ${rec.title}` });
    } catch {
      if (seq !== selectSeq) {
        return;
      }
      set({
        session: seeded,
        viewingSessionId: id,
        restoringSessionId: null,
        bridgeInfo: "Showing local history — resume failed, check bridge",
      });
    }
  })();
}

/**
 * Remove a session from catalog and pool; may re-focus another row.
 * Forgets busy→idle edge memory for this id so a later idle restore
 * of the same id is not treated as a turn settle.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param id Session id to drop.
 */
export function removeSessionAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
  id: string,
): void {
  // Reclaim child process (if in pool)
  get().live?.closeSession(id);
  forgetTurnEdge(id);
  // Filter-only: still normalize so ghost prune / sort stay consistent.
  const catalog = get().catalog.filter((s) => s.id !== id);
  persistCatalog(catalog);
  flushCatalogPersist();
  const poolEntries = get().poolEntries.filter((e) => e.sessionId !== id);
  const patch: Partial<SessionStore> = { catalog, poolEntries };
  if (get().restoringSessionId === id) {
    patch.restoringSessionId = null;
  }
  if (get().activeSessionId === id) {
    patch.activeSessionId = null;
  }
  // Drop queue items that targeted the deleted session.
  patch.promptQueue = get().promptQueue.filter((item) => item.sessionId !== id);

  if (get().viewingSessionId === id) {
    get().clearPendingMode();
    const next = catalog[0];
    set(patch);
    if (next) {
      // Full select path resumes live + seeds pool status correctly.
      selectSessionAction(set, get, next.id);
    } else {
      set({
        viewingSessionId: null,
        session: INITIAL_SESSION,
        localDraft: false,
        creatingSession: false,
        viewingSubagent: false,
        viewingParentSessionId: undefined,
      });
    }
    return;
  }
  set(patch);
}

/**
 * Persist current session into catalog and tear down live bridge.
 * Clears all busy→idle edge memory so the next idle restore is not a settle.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function disconnectAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): void {
  forgetAllTurnEdges();
  cancelPendingSessionsSync();
  const s = get().session;
  // Always flush pending so unproven multi-client sessions are not lost.
  let catalog = get().catalog;
  let provenance = get().sessionProvenance;
  const pendingFlush = flushPendingSessionsToCatalog(
    catalog,
    get().pendingSessions,
    provenance,
  );
  catalog = pendingFlush.catalog;
  provenance = pendingFlush.provenance;

  if (s.id) {
    // Promote buffered children so L3 drill-down still resolves offline.
    const parentWs: Record<string, string> = {};
    for (const rec of catalog) {
      if (rec.workspace.trim()) {
        parentWs[rec.id] = rec.workspace;
      }
    }
    if (s.workspace.trim()) {
      parentWs[s.id] = s.workspace;
    }
    const flushed = flushChildSessionsToCatalog(
      upsertFromLiveState(catalog, {
        ...s,
        status: "disconnected",
      }),
      get().childSessions,
      get().sessionRoles,
      parentWs,
    );
    catalog = normalizeCatalog(flushed.catalog);
    persistNormalizedCatalog(catalog);
    flushCatalogPersist();
    set({
      catalog,
      childSessions: flushed.remaining,
      pendingSessions: {},
      pendingSessionOrder: [],
      sessionProvenance: provenance,
    });
  } else {
    persistNormalizedCatalog(catalog);
    flushCatalogPersist();
    set({
      catalog,
      pendingSessions: {},
      pendingSessionOrder: [],
      sessionProvenance: provenance,
    });
  }
  // stopPoolPoll is also called from onClose; clear here so a close that
  // never fires onClose (already-null live) still ends the interval.
  stopPoolPoll();
  get().live?.close();
  set((state) => ({
    live: null,
    connectionMode: "disconnected",
    lastError: null,
    localDraft: false,
    creatingSession: false,
    restoringSessionId: null,
    poolEntries: [],
    session: markDisconnected(state.session),
    bridgeInfo:
      "Disconnected — click a session or Reconnect to resume (will not create a new session)",
  }));
}
