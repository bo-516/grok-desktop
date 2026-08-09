/**
 * Zustand session store — LIVE grok-build only (multi-session pool + env probe).
 *
 * Reconnect / open session → resume (session/load); only New chat uses forceNew.
 * Background session state still upserts the catalog; main canvas only follows viewingSessionId.
 */

import { create } from "zustand";
import {
  createSessionState,
  markDisconnected,
  type AgentMode,
  type ContentBlock,
  type SessionState,
  type SessionUpdate,
  applySessionUpdate,
} from "@grok-desktop/acp-core";
import type { EnvironmentInfo, PoolEntry } from "../bridge/liveBridge";
import {
  loadCatalogFromStorage,
  normalizeCatalog,
  recordToSessionState,
  upsertFromLiveState,
  type SessionRecord,
} from "./sessionCatalog";
import {
  DEFAULT_ALWAYS_APPROVE,
  startLiveBridgeSession,
  stopPoolPoll,
  type ConnectionMode,
  type LiveHandle,
} from "./sessionStoreLive";
import {
  INITIAL_SESSION,
  persistCatalog,
  resolveResumeTarget,
  type StartOpts,
} from "./sessionStoreSupport";
import {
  armPendingModeTimeout,
  clearPendingModeTimer,
} from "./pendingMode";

export type { ConnectionMode, EnvironmentInfo, PoolEntry };

type SessionStore = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: PoolEntry[];
  environment: EnvironmentInfo | null;
  /**
   * Mode the user requested that is not yet confirmed by the agent.
   * Non-null while a mode switch is in flight; UI keeps the short target mode
   * label + busy chrome, cleared on current_mode_update match or timeout.
   */
  pendingMode: AgentMode | null;
  startLiveBridge: (opts?: StartOpts) => Promise<void>;
  newSession: (cwd?: string) => Promise<void>;
  reconnect: () => Promise<void>;
  selectSession: (id: string) => void;
  removeSession: (id: string) => void;
  /**
   * Send prompt text and optional multi-block content (images / resource_link).
   * @param text User text (also used for queue key).
   * @param blocks Optional ACP ContentBlocks; when set, bridge sends full prompt array.
   */
  sendPrompt: (
    text: string,
    blocks?: ContentBlock[],
  ) => Promise<boolean>;
  cancelTurn: () => void;
  respondPermission: (optionId: string) => void;
  /**
   * Request a mode switch: sets pendingMode, calls bridge; does not claim success
   * until session.mode matches or the pending timeout settles optimistically.
   * @param mode Target agent mode.
   */
  setMode: (mode: AgentMode) => void;
  /** Clear pendingMode (timeout settle or external cancel). */
  clearPendingMode: () => void;
  /**
   * Select model: calls bridge session/set_model when live; optimistic local update.
   * On ACP unsupported, bridge emits restart_required (J-06).
   */
  setModel: (model: string) => void;
  /** Queue of prompts waiting while turn is streaming (F-STREAM-09). */
  promptQueue: string[];
  enqueuePrompt: (text: string) => void;
  dequeuePrompt: () => string | null;
  clearPromptQueue: () => void;
  /** Last SPAWN restart notice for UI banner (J-06). */
  restartNotice: string | null;
  clearRestartNotice: () => void;
  /** Run one-shot CLI channel via live bridge. */
  runCli: (
    command: string,
    args?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  /** Restart session process with new SPAWN config + session/load. */
  restartWithSpawn: (spawnConfig: Record<string, unknown>) => boolean;
  disconnect: () => void;
  hydrateCatalog: () => void;
  refreshEnvironment: () => void;
};

/** Selection sequence while async resume is in flight. */
let selectSeq = 0;

export const useSessionStore = create<SessionStore>((set, get) => ({
  session: INITIAL_SESSION,
  connectionMode: "disconnected",
  bridgeInfo: "not connected — start bridge then Connect",
  lastError: null,
  live: null,
  catalog: [],
  activeSessionId: null,
  viewingSessionId: null,
  poolEntries: [],
  environment: null,
  pendingMode: null,
  promptQueue: [],
  restartNotice: null,

  hydrateCatalog: () => {
    set({ catalog: loadCatalogFromStorage() });
  },

  refreshEnvironment: () => {
    get().live?.checkEnvironment();
  },

  clearRestartNotice: () => set({ restartNotice: null }),

  clearPendingMode: () => {
    clearPendingModeTimer();
    set({ pendingMode: null });
  },

  enqueuePrompt: (text) => {
    const t = text.trim();
    if (!t) {
      return;
    }
    set((s) => ({ promptQueue: [...s.promptQueue, t] }));
  },

  dequeuePrompt: () => {
    const q = get().promptQueue;
    if (q.length === 0) {
      return null;
    }
    const [head, ...rest] = q;
    set({ promptQueue: rest });
    return head ?? null;
  },

  clearPromptQueue: () => set({ promptQueue: [] }),

  setMode: (mode) => {
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
    armPendingModeTimeout(() => {
      const pending = get().pendingMode;
      if (pending === null) {
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
    const cwd = get().session.workspace || undefined;
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

  newSession: async (cwd) => {
    const workspace = cwd ?? get().session.workspace;
    selectSeq += 1;
    const prev = get().session;
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
        session: createSessionState({
          id: "",
          workspace: workspace || prev.workspace,
          mode: prev.mode,
        }),
      });
    }
    await get().startLiveBridge({
      alwaysApprove: DEFAULT_ALWAYS_APPROVE,
      cwd: workspace || undefined,
      forceNew: true,
    });
  },

  reconnect: async () => {
    const target = resolveResumeTarget(get(), {});
    await get().startLiveBridge({
      alwaysApprove: DEFAULT_ALWAYS_APPROVE,
      cwd: target.cwd,
      resumeId: target.resumeId,
      seed: target.seed,
      forceNew: !target.resumeId,
    });
  },

  selectSession: (id) => {
    const rec = get().catalog.find((s) => s.id === id);
    if (!rec) {
      return;
    }

    const seq = ++selectSeq;
    const seeded = recordToSessionState(rec);
    const inPool = get().poolEntries.some((e) => e.sessionId === id && e.live);

    set({
      viewingSessionId: id,
      session: seeded,
      lastError: null,
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
        await get().startLiveBridge({
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
          bridgeInfo: "Showing local history — resume failed, check bridge",
        });
      }
    })();
  },

  removeSession: (id) => {
    // Reclaim child process (if in pool)
    get().live?.closeSession(id);
    const catalog = get().catalog.filter((s) => s.id !== id);
    persistCatalog(catalog);
    const poolEntries = get().poolEntries.filter((e) => e.sessionId !== id);
    const patch: Partial<SessionStore> = { catalog, poolEntries };
    if (get().viewingSessionId === id) {
      const next = catalog[0];
      if (next) {
        patch.viewingSessionId = next.id;
        patch.session = recordToSessionState(next);
      } else {
        patch.viewingSessionId = null;
        patch.session = INITIAL_SESSION;
      }
    }
    if (get().activeSessionId === id) {
      patch.activeSessionId = null;
    }
    set(patch);
  },

  sendPrompt: async (draft, blocks) => {
    const { connectionMode, live, session, viewingSessionId, lastError } =
      get();
    const text = draft.trim();
    // Allow image-only sends (blocks with image, empty text).
    const hasBlocks = Array.isArray(blocks) && blocks.length > 0;
    if (!text && !hasBlocks) {
      return false;
    }

    // Queue while turn is in flight (F-STREAM-09) — never drop user text.
    // Queued items are text-only; multi-block must wait for idle (J-06 honesty).
    if (
      connectionMode === "live-bridge" &&
      live &&
      (session.status === "streaming" || session.status === "waiting_permission")
    ) {
      if (hasBlocks && !text) {
        set({
          bridgeInfo:
            "Attachments wait until the current turn finishes — try again when idle",
        });
        return false;
      }
      get().enqueuePrompt(text || "(attachment pending)");
      set({
        bridgeInfo: `Queued (${get().promptQueue.length}) — will send after turn`,
      });
      return true;
    }

    if (connectionMode !== "live-bridge" || !live) {
      const id = viewingSessionId || session.id || get().catalog[0]?.id;
      try {
        if (id) {
          const rec = get().catalog.find((s) => s.id === id);
          await get().startLiveBridge({
            alwaysApprove: DEFAULT_ALWAYS_APPROVE,
            cwd: rec?.workspace || session.workspace || undefined,
            resumeId: id,
            seed: rec ? recordToSessionState(rec) : session,
          });
        } else {
          await get().startLiveBridge({
            alwaysApprove: DEFAULT_ALWAYS_APPROVE,
            forceNew: true,
          });
        }
      } catch {
        set({
          bridgeInfo: "Cannot connect to bridge. Run npm run bridge first",
        });
        return false;
      }
    }

    const handle = get().live;
    if (!handle) {
      return false;
    }

    const err = get().lastError;
    if (err) {
      set({
        bridgeInfo: `Cannot send: ${err}. Try "New chat" or "Reconnect"`,
      });
      return false;
    }

    const sid = get().session.id || get().activeSessionId || get().viewingSessionId;
    if (!sid) {
      set({ bridgeInfo: "Session not ready yet — wait or click New chat" });
      return false;
    }

    // Slash commands route as prompt text; multi-block path carries images (F-STREAM-07).
    const ok = handle.prompt(text, sid, hasBlocks ? blocks : undefined);
    if (!ok) {
      set({
        bridgeInfo: "Send failed: bridge not connected. Run npm run bridge",
        lastError: lastError ?? "bridge not connected",
      });
      return false;
    }
    return true;
  },

  cancelTurn: () => {
    const { connectionMode, live, session, viewingSessionId, activeSessionId } =
      get();
    if (connectionMode === "live-bridge" && live) {
      live.cancel(session.id || viewingSessionId || activeSessionId || undefined);
    }
  },

  respondPermission: (optionId) => {
    const { connectionMode, live, session, viewingSessionId, activeSessionId } =
      get();
    if (connectionMode === "live-bridge" && live) {
      live.permission(
        optionId,
        session.id || viewingSessionId || activeSessionId || undefined,
      );
    }
  },

  disconnect: () => {
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
      poolEntries: [],
      session: markDisconnected(state.session),
      bridgeInfo:
        "Disconnected — click a session or Reconnect to resume (will not create a new session)",
    }));
  },
}));

export function applyToolFixtureThroughCore(
  state: SessionState,
  updates: SessionUpdate[],
): SessionState {
  return updates.reduce((acc, u) => applySessionUpdate(acc, u), state);
}

export type { ContentBlock, SessionState, SessionRecord };
