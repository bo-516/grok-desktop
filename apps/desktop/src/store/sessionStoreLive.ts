/**
 * Live bridge connect/start logic (split from sessionStore to keep file size down).
 * Operates only on the real grok-build bridge; no mock path.
 */

import {
  markDisconnected,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  connectLiveBridge,
  defaultBridgeUrl,
  type StartOpts as BridgeStartOpts,
} from "../bridge/liveBridge";
import {
  normalizeCatalog,
  upsertFromLiveState,
} from "./sessionCatalog";
import {
  persistCatalog,
  resolveResumeTarget,
  type StartOpts,
} from "./sessionStoreSupport";

/** Product UI path never auto-approves tools by default; e2e may pass true explicitly. */
export const DEFAULT_ALWAYS_APPROVE = false;

export type ConnectionMode = "live-bridge" | "disconnected" | "connecting";

export type LiveHandle = ReturnType<typeof connectLiveBridge>;

/** Minimal store slice read/written by startLiveBridge; avoids a circular SessionStore type dependency. */
export type LiveStoreSlice = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: ReturnType<typeof normalizeCatalog>;
  activeSessionId: string | null;
  viewingSessionId: string | null;
};

type SetState = (
  partial:
    | Partial<LiveStoreSlice>
    | ((state: LiveStoreSlice) => Partial<LiveStoreSlice>),
) => void;
type GetState = () => LiveStoreSlice;

/**
 * Connect to the real bridge and start/resume a session.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts forceNew / resumeId / alwaysApprove, etc.; alwaysApprove defaults to false.
 * @returns Promise; rejects when the WebSocket fails.
 */
export async function startLiveBridgeSession(
  set: SetState,
  get: GetState,
  opts?: StartOpts,
): Promise<void> {
  const resolved = resolveResumeTarget(get(), opts);
  const resumeId = resolved.resumeId;
  const seed = resolved.seed ?? opts?.seed;
  const cwd = resolved.cwd ?? opts?.cwd;
  const forceNew = Boolean(opts?.forceNew);
  const alwaysApprove = opts?.alwaysApprove ?? DEFAULT_ALWAYS_APPROVE;
  // Clear the previous error before each start/resume so send is not blocked by stale state;
  // onError will write a new error if this attempt fails.
  set({ lastError: null });

  const prev = get().session;
  if (prev.id && prev.timeline.length > 0) {
    const catalog = normalizeCatalog(
      upsertFromLiveState(get().catalog, prev),
    );
    persistCatalog(catalog);
    set({ catalog });
  }

  let live = get().live;
  if (!live || get().connectionMode === "disconnected") {
    get().live?.close();
    /** Connecting status copy: resume / new session / default connect. */
    let connectingInfo = "Connecting live grok…";
    if (resumeId) {
      connectingInfo = `Resuming session ${resumeId.slice(0, 8)}…`;
    } else if (forceNew) {
      connectingInfo = "Creating new session…";
    }
    set({
      live: null,
      lastError: null,
      bridgeInfo: connectingInfo,
      connectionMode: "connecting",
    });

    const url = opts?.url ?? defaultBridgeUrl();
    try {
      live = connectLiveBridge(url, {
        onState: (session) => {
          const catalog = normalizeCatalog(
            upsertFromLiveState(get().catalog, session),
          );
          persistCatalog(catalog);
          const viewing = get().viewingSessionId;
          const follow =
            !viewing ||
            viewing === session.id ||
            get().activeSessionId === session.id;
          set({
            catalog,
            activeSessionId: session.id || get().activeSessionId,
            connectionMode: "live-bridge",
            lastError: null,
            ...(follow
              ? {
                  session: { ...session },
                  viewingSessionId: session.id,
                }
              : {}),
          });
        },
        onInfo: (message) => {
          set({ bridgeInfo: message, lastError: null });
        },
        onError: (message) => {
          set({
            bridgeInfo: `error: ${message}`,
            lastError: message,
          });
        },
        onHello: (cwdHello) => {
          set({ bridgeInfo: `live grok-build · cwd=${cwdHello}` });
        },
        onClose: () => {
          set((s) => {
            const catalog = s.session.id
              ? normalizeCatalog(
                  upsertFromLiveState(s.catalog, {
                    ...s.session,
                    status: "disconnected",
                  }),
                )
              : s.catalog;
            persistCatalog(catalog);
            return {
              live: null,
              connectionMode: "disconnected" as const,
              catalog,
              session: markDisconnected(s.session),
              lastError: null,
              bridgeInfo:
                "Bridge disconnected — history kept; click a session or Reconnect to resume",
            };
          });
        },
      });
      set({ live });
      await live.ready;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({
        live: null,
        connectionMode: "disconnected",
        lastError: message,
        bridgeInfo: `Cannot connect to bridge (${message}). Run npm run bridge`,
      });
      throw e;
    }
  }

  if (seed && resumeId) {
    set({
      session: {
        ...seed,
        status: "idle",
        pendingPermission: undefined,
      },
      viewingSessionId: resumeId,
      activeSessionId: resumeId,
    });
  }

  const startOpts: BridgeStartOpts = {
    alwaysApprove,
    cwd,
    resumeId: forceNew ? undefined : resumeId,
    seed: forceNew ? undefined : seed,
    forceNew,
  };
  const started = live.start(startOpts);
  if (!started) {
    set({
      connectionMode: "disconnected",
      lastError: "WebSocket not connected",
      bridgeInfo: "Cannot write to bridge — run npm run bridge and retry",
    });
    throw new Error("bridge WebSocket not open");
  }

  /** Connected status copy: resume / new session / default connected. */
  let liveInfo = "live · connected";
  if (resumeId && !forceNew) {
    liveInfo = "live · resumed";
  } else if (forceNew) {
    liveInfo = "live · new session";
  }
  set({
    connectionMode: "live-bridge",
    bridgeInfo: liveInfo,
    viewingSessionId: forceNew
      ? get().viewingSessionId
      : resumeId ?? get().viewingSessionId,
  });
}
