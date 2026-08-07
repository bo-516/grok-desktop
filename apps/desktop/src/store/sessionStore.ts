/**
 * Zustand session store — LIVE grok-build only.
 *
 * Reconnect / open session → always resume (session/load), never spawn a new
 * ACP session unless the user explicitly clicks New chat (forceNew).
 *
 * Product default alwaysApprove=false: permissions must be confirmed in the UI,
 * never silently auto-approved.
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
  type ConnectionMode,
  type LiveHandle,
} from "./sessionStoreLive";
import {
  INITIAL_SESSION,
  persistCatalog,
  resolveResumeTarget,
  type StartOpts,
} from "./sessionStoreSupport";

export type { ConnectionMode };

type SessionStore = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  /** Last actionable bridge/agent error; cleared after a successful start/state. */
  lastError: string | null;
  live: LiveHandle | null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  startLiveBridge: (opts?: StartOpts) => Promise<void>;
  /** Explicit new ACP session (session/new). */
  newSession: (cwd?: string) => Promise<void>;
  /** Reconnect bridge and resume current (or last) session — no new id. */
  reconnect: () => Promise<void>;
  selectSession: (id: string) => void;
  removeSession: (id: string) => void;
  /** Local draft from the send component; returns false on failure so the input text is kept. */
  sendPrompt: (text: string) => Promise<boolean>;
  cancelTurn: () => void;
  respondPermission: (optionId: string) => void;
  setMode: (mode: AgentMode) => void;
  disconnect: () => void;
  hydrateCatalog: () => void;
};

/** Selection sequence while async resume is in flight; stale requests must not overwrite a later user choice. */
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

  hydrateCatalog: () => {
    set({ catalog: loadCatalogFromStorage() });
  },

  setMode: (mode) =>
    set((s) => ({ session: { ...s.session, mode } })),

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
    if (!rec) {return;}

    const seq = ++selectSeq;
    const seeded = recordToSessionState(rec);

    set({
      viewingSessionId: id,
      session: seeded,
      lastError: null,
      bridgeInfo: `Opened · ${rec.title}`,
    });

    if (
      id === get().activeSessionId &&
      get().connectionMode === "live-bridge" &&
      get().live &&
      !get().lastError
    ) {
      set({ bridgeInfo: `live · ${rec.title}` });
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
        if (seq !== selectSeq) {return;}
        set({ bridgeInfo: `live · ${rec.title}` });
      } catch {
        if (seq !== selectSeq) {return;}
        set({
          session: seeded,
          viewingSessionId: id,
          bridgeInfo: "Showing local history — resume failed, check bridge",
        });
      }
    })();
  },

  removeSession: (id) => {
    const catalog = get().catalog.filter((s) => s.id !== id);
    persistCatalog(catalog);
    const patch: Partial<SessionStore> = { catalog };
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

  /**
   * Send the Composer's local draft through the real bridge.
   * @param draft Current input text; returns false when blank, offline, or resume failed — caller must keep the text.
   * @returns Whether a non-empty prompt was written to the live bridge.
   */
  sendPrompt: async (draft) => {
    const { connectionMode, live, session, viewingSessionId, lastError } =
      get();
    const text = draft.trim();
    if (!text) {return false;}

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
    if (!handle) {return false;}

    // After a failed session resume, block fake sends (would clear the draft with no agent response)
    const err = get().lastError;
    if (err) {
      set({
        bridgeInfo: `Cannot send: ${err}. Try "New chat" or "Reconnect"`,
      });
      return false;
    }

    const sid = get().session.id || get().activeSessionId;
    if (!sid) {
      set({ bridgeInfo: "Session not ready yet — wait or click New chat" });
      return false;
    }

    const ok = handle.prompt(text);
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
    const { connectionMode, live } = get();
    if (connectionMode === "live-bridge" && live) {
      live.cancel();
    }
  },

  respondPermission: (optionId) => {
    const { connectionMode, live } = get();
    if (connectionMode === "live-bridge" && live) {
      live.permission(optionId);
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
    get().live?.close();
    set((state) => ({
      live: null,
      connectionMode: "disconnected",
      lastError: null,
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
