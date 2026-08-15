/**
 * Zustand session store — LIVE grok-build only (multi-session pool + env probe).
 *
 * Reconnect / open session → resume (session/load).
 * New chat is a local draft; forceNew runs only on the first real sendPrompt.
 * Background session state still upserts the catalog; main canvas only follows viewingSessionId.
 *
 * Navigation / prompt / queue / auto-reconnect actions live in
 * sessionStoreNavigation, sessionStorePrompt, sessionStoreQueue,
 * and sessionStoreReconnect.
 */

import { create } from "zustand";
import {
  applySessionUpdate,
  type AgentMode,
  type SessionState,
  type SessionUpdate,
} from "@grok-desktop/acp-core";
import { loadCatalogFromStorage } from "./sessionCatalog";
import {
  DEFAULT_ALWAYS_APPROVE,
  startLiveBridgeSession,
  syncCatalogFromBridge,
} from "./sessionStoreLive";
import { rolesFromCatalog } from "./sessionRoles";
import { provenanceFromCatalog } from "./sessionProvenance";
import { INITIAL_SESSION } from "./sessionStoreSupport";
import {
  armPendingModeTimeout,
  clearPendingModeTimer,
} from "./pendingMode";
import { registerSessionDiagnostics } from "./sessionDiagnostics";
import type { SessionStore } from "./sessionStoreTypes";
import {
  cancelTurnAction,
  dequeuePromptAction,
  enqueuePromptAction,
  respondPermissionAction,
  sendPromptAction,
} from "./sessionStorePrompt";
import {
  removeQueuedPromptAction,
  sendQueuedNowAction,
} from "./sessionStoreQueue";
import {
  disconnectAction,
  newSessionAction,
  reconnectAction,
  removeSessionAction,
  selectSessionAction,
  setWorkspaceAction,
} from "./sessionStoreNavigation";
import { ensureLiveBridgeConnected } from "./sessionStoreReconnect";
import { renameSessionAction } from "./sessionStoreRename";
import { forkSessionAction } from "./sessionStoreFork";
import { refreshWeeklyUsageAction } from "./sessionStoreBilling";
import { authLoginAction, authLogoutAction } from "./sessionStoreAuth";

export type {
  ConnectionMode,
  ContentBlock,
  EnvironmentInfo,
  PoolEntry,
  SessionRecord,
  SessionState,
  SetWorkspaceResult,
} from "./sessionStoreTypes";

export const useSessionStore = create<SessionStore>((set, get) => ({
  session: INITIAL_SESSION,
  connectionMode: "disconnected",
  bridgeInfo: "not connected — start bridge then Connect",
  lastError: null,
  live: null,
  catalog: [],
  activeSessionId: null,
  viewingSessionId: null,
  viewingSubagent: false,
  viewingParentSessionId: undefined,
  /** childSessionId → parent role; rebuilt from catalog on hydrate. */
  sessionRoles: {},
  /** Streaming child reduce buffers (memory only). */
  childSessions: {},
  /** sessionId → provenance; rebuilt from catalog on hydrate. */
  sessionProvenance: {},
  /** Unproven wire-only buffers (memory only). */
  pendingSessions: {},
  pendingSessionOrder: [],
  /** Bumped when catalog identity changes for Agents openable-id deps. */
  catalogRevision: 0,
  poolEntries: [],
  environment: null,
  /** null until the first probe answers — the gate stays shut while unknown. */
  authed: null,
  weeklyUsage: null,
  /** True after New chat until first send or selectSession. */
  localDraft: false,
  /** True only while first send of a New chat draft is forceNew-creating. */
  creatingSession: false,
  pendingMode: null,
  /** Non-null only while an uncached session waits for disk hydrate or session/load. */
  restoringSessionId: null,
  promptQueue: [],
  restartNotice: null,

  hydrateCatalog: () => {
    const catalog = loadCatalogFromStorage();
    set({
      catalog,
      sessionRoles: rolesFromCatalog(catalog),
      sessionProvenance: provenanceFromCatalog(catalog),
      pendingSessions: {},
      pendingSessionOrder: [],
      catalogRevision: (get().catalogRevision ?? 0) + 1,
    });
  },

  refreshEnvironment: () => {
    get().live?.checkEnvironment();
  },

  refreshAuth: () => {
    get().live?.checkAuth();
  },

  authLogin: async () => authLoginAction(set, get),

  authLogout: async () => authLogoutAction(set, get),

  refreshWeeklyUsage: async () => refreshWeeklyUsageAction(set, get),

  clearRestartNotice: () => set({ restartNotice: null }),

  clearPendingMode: () => {
    clearPendingModeTimer();
    set({ pendingMode: null });
  },

  enqueuePrompt: (text) => enqueuePromptAction(set, get, text),
  dequeuePrompt: () => dequeuePromptAction(set, get),
  clearPromptQueue: () => set({ promptQueue: [] }),
  removeQueuedPrompt: (id) => removeQueuedPromptAction(set, get, id),
  sendQueuedPromptNow: (id) => sendQueuedNowAction(set, get, id),

  setMode: (mode: AgentMode) => {
    const current = get().session.mode;
    if (current === mode && get().pendingMode === null) {
      return;
    }
    // Do not optimistically claim the new mode — show pending until confirm/timeout.
    set({ pendingMode: mode });
    const live = get().live;
    const sid =
      get().session.id || get().activeSessionId || get().viewingSessionId;
    if (live && get().connectionMode === "live-bridge" && sid) {
      live.setMode(mode, sid);
    }
    // If agent never emits current_mode_update, settle optimistically after timeout.
    const modeSessionId =
      get().session.id || get().activeSessionId || get().viewingSessionId;
    armPendingModeTimeout(() => {
      const pending = get().pendingMode;
      if (pending === null) {
        return;
      }
      // Only stamp mode on the canvas that requested the switch.
      const currentId =
        get().session.id || get().activeSessionId || get().viewingSessionId;
      if (modeSessionId && currentId && modeSessionId !== currentId) {
        set({ pendingMode: null });
        return;
      }
      set((s) => ({
        pendingMode: null,
        session: { ...s.session, mode: pending },
      }));
    });
  },

  setModel: (model) => {
    const modelId = model.trim();
    if (!modelId) {
      return;
    }
    set((s) => ({
      session: { ...s.session, model: modelId },
    }));
    const live = get().live;
    const sid =
      get().session.id || get().activeSessionId || get().viewingSessionId;
    if (live && get().connectionMode === "live-bridge" && sid) {
      live.setModel(modelId, sid);
    }
  },

  runCli: async (command, args) => {
    const live = get().live;
    if (!live || get().connectionMode !== "live-bridge") {
      return { ok: false, error: "bridge not connected" };
    }
    // Global session enumeration must not inherit the open session cwd
    // (that would hide other workspaces in the rail). Other CLI tools keep cwd.
    const cwd =
      command === "sessions_list" || command === "sessions_search"
        ? undefined
        : get().session.workspace || undefined;
    try {
      const result = await live.cli(command, args, cwd);
      return result;
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },

  syncRemoteSessions: async () => {
    const live = get().live;
    if (!live || get().connectionMode !== "live-bridge") {
      return { ok: false, count: 0, error: "bridge not connected" };
    }
    return syncCatalogFromBridge(live, set, get);
  },

  forkSession: async (opts) => forkSessionAction(set, get, opts),

  restartWithSpawn: (spawnConfig) => {
    const live = get().live;
    const sid =
      get().session.id || get().activeSessionId || get().viewingSessionId;
    if (!live || !sid) {
      return false;
    }
    set({
      restartNotice: `Restarting session to apply SPAWN settings…`,
    });
    return live.restartSession(sid, spawnConfig, DEFAULT_ALWAYS_APPROVE);
  },

  startLiveBridge: async (opts) => {
    await startLiveBridgeSession(set, get, opts);
  },

  newSession: async (cwd) => newSessionAction(set, get, cwd),
  setWorkspace: async (cwd) => setWorkspaceAction(set, get, cwd),
  reconnect: async () => reconnectAction(set, get),
  ensureConnected: async () => ensureLiveBridgeConnected(set, get),
  selectSession: (id) => selectSessionAction(set, get, id),
  removeSession: (id) => removeSessionAction(set, get, id),
  renameSession: (id, title) => renameSessionAction(set, get, id, title),
  sendPrompt: async (draft, blocks) =>
    sendPromptAction(set, get, draft, blocks),
  cancelTurn: () => cancelTurnAction(get),
  respondPermission: (optionId) => respondPermissionAction(get, optionId),
  disconnect: () => disconnectAction(set, get),
}));

// Dev console: `__grokDiag()` — not registered in production builds.
registerSessionDiagnostics(() => useSessionStore.getState());

/**
 * Replay tool-card updates through the pure core reducer (fixtures / tests).
 * @param state Starting SessionState.
 * @param updates Ordered session/update events.
 * @returns Folded state after all updates.
 */
export function applyToolFixtureThroughCore(
  state: SessionState,
  updates: SessionUpdate[],
): SessionState {
  return updates.reduce((acc, u) => applySessionUpdate(acc, u), state);
}
