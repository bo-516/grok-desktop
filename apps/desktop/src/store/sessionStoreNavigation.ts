/**
 * Session store actions: new/select/remove/workspace/reconnect/disconnect.
 * Wired into useSessionStore; no React.
 */

import { createSessionState, markDisconnected } from "@grok-desktop/acp-core";
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
  DEFAULT_ALWAYS_APPROVE,
  startLiveBridgeSession,
  stopPoolPoll,
} from "./sessionStoreLive";
import {
  INITIAL_SESSION,
  persistCatalog,
  resolveResumeTarget,
} from "./sessionStoreSupport";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
  SetWorkspaceResult,
} from "./sessionStoreTypes";

/** Selection sequence while async resume is in flight (stale async guards). */
let selectSeq = 0;

/**
 * Bump select sequence (tests / external cancel of in-flight select).
 * @returns New sequence number.
 */
export function bumpSelectSeq(): number {
  selectSeq += 1;
  return selectSeq;
}

/**
 * Open a local New chat draft. Does **not** call session/new on the bridge;
 * the real session is created on the first successful sendPrompt (forceNew).
 * Optional cwd overrides workspace prefs for the draft and later create.
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
  const prev = get().session;
  // Persist the previous live canvas into the rail before blanking the UI.
  // No bridge spawn here — avoids empty "Chat xxxx" ghosts until the user sends.
  if (prev.id) {
    const catalog = normalizeCatalog(
      upsertFromLiveState(get().catalog, prev),
    );
    persistCatalog(catalog);
    set({
      catalog,
      viewingSessionId: null,
      activeSessionId: null,
      lastError: null,
      localDraft: true,
      creatingSession: false,
      restoringSessionId: null,
      bridgeInfo: "New chat — send a message to start",
      session: createSessionState({
        id: "",
        workspace,
        mode: prev.mode,
      }),
    });
    return;
  }
  set({
    viewingSessionId: null,
    activeSessionId: null,
    lastError: null,
    localDraft: true,
    creatingSession: false,
    bridgeInfo: "New chat — send a message to start",
    session: createSessionState({
      id: "",
      workspace,
      mode: prev.mode,
    }),
  });
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
  const rec = get().catalog.find((s) => s.id === id);
  if (!rec) {
    return;
  }

  const seq = ++selectSeq;
  const seeded = recordToSessionState(rec);
  const inPool = get().poolEntries.some((e) => e.sessionId === id && e.live);
  /**
   * Nothing cached to paint: session/load replay is the only source of body,
   * and it stays silent until it completes, so the canvas needs a restore hint
   * instead of the New chat empty state.
   */
  const coldRestore = seeded.timeline.length === 0 && !inPool;

  set({
    viewingSessionId: id,
    session: seeded,
    lastError: null,
    localDraft: false,
    creatingSession: false,
    restoringSessionId: coldRestore ? id : null,
    bridgeInfo: inPool ? `live · ${rec.title}` : `Opened · ${rec.title}`,
  });

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
  const catalog = get().catalog.filter((s) => s.id !== id);
  persistCatalog(catalog);
  const poolEntries = get().poolEntries.filter((e) => e.sessionId !== id);
  const patch: Partial<SessionStore> = { catalog, poolEntries };
  if (get().restoringSessionId === id) {
    patch.restoringSessionId = null;
  }
  if (get().viewingSessionId === id) {
    const next = catalog[0];
    if (next) {
      patch.viewingSessionId = next.id;
      patch.session = recordToSessionState(next);
      patch.localDraft = false;
      patch.creatingSession = false;
    } else {
      patch.viewingSessionId = null;
      patch.session = INITIAL_SESSION;
      // Empty rail: blank canvas is not a deliberate New chat draft.
      patch.localDraft = false;
      patch.creatingSession = false;
    }
  }
  if (get().activeSessionId === id) {
    patch.activeSessionId = null;
  }
  set(patch);
}

/**
 * Persist current session into catalog and tear down live bridge.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function disconnectAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): void {
  const s = get().session;
  if (s.id) {
    const catalog = normalizeCatalog(
      upsertFromLiveState(get().catalog, {
        ...s,
        status: "disconnected",
      }),
    );
    persistCatalog(catalog);
    set({ catalog });
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
