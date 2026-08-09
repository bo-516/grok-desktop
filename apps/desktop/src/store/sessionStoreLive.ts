/**
 * Live bridge connect/start (multi-session): pool state, env probe, canvas follows viewing.
 * Real grok-build bridge only; no mock path.
 */

import {
  markDisconnected,
  tagSeedUserMessages,
  type AgentMode,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  connectLiveBridge,
  defaultBridgeUrl,
  type EnvironmentInfo,
  type PoolEntry,
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
import { clearPendingModeTimer } from "./pendingMode";

/** Product UI path never auto-approves tools by default. */
export const DEFAULT_ALWAYS_APPROVE = false;

export type ConnectionMode = "live-bridge" | "disconnected" | "connecting";

export type LiveHandle = ReturnType<typeof connectLiveBridge>;

/** Minimal store slice for startLiveBridge。 */
export type LiveStoreSlice = {
  session: SessionState;
  connectionMode: ConnectionMode;
  bridgeInfo: string;
  lastError: string | null;
  live: LiveHandle | null;
  catalog: ReturnType<typeof normalizeCatalog>;
  activeSessionId: string | null;
  viewingSessionId: string | null;
  /** Resident process summaries in the pool (rail status lights). */
  poolEntries: PoolEntry[];
  /** CLI / login probe; null means not received yet. */
  environment: EnvironmentInfo | null;
  /** Queued user prompts while streaming. */
  promptQueue: string[];
  /** SPAWN restart banner (J-06). */
  restartNotice: string | null;
  /**
   * In-flight mode switch target; cleared when inbound session.mode matches.
   * Optional so older call sites still type-check.
   */
  pendingMode?: AgentMode | null;
};

type SetState = (
  partial:
    | Partial<LiveStoreSlice>
    | ((state: LiveStoreSlice) => Partial<LiveStoreSlice>),
) => void;
type GetState = () => LiveStoreSlice;

/**
 * Whether inbound state should paint onto the main canvas.
 * @param viewing Currently viewed session.
 * @param active Most recently active id.
 * @param sessionId Inbound session id.
 */
export function shouldFollowSession(
  viewing: string | null,
  active: string | null,
  sessionId: string,
): boolean {
  if (!sessionId) {
    return true;
  }
  if (!viewing) {
    return true;
  }
  return viewing === sessionId || active === sessionId;
}

/**
 * Heal exact X+X user bodies on any inbound live state before paint/persist.
 * @param session Raw ACP session from bridge / pool.
 * @returns Session with tagSeedUserMessages applied to the timeline.
 */
export function healSessionTimeline(session: SessionState): SessionState {
  return {
    ...session,
    timeline: tagSeedUserMessages(session.timeline),
  };
}

/**
 * Connect to the real bridge and start/resume a session (pool acquire).
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
          const healed = healSessionTimeline(session);
          const catalog = normalizeCatalog(
            upsertFromLiveState(get().catalog, healed),
          );
          persistCatalog(catalog);
          const viewing = get().viewingSessionId;
          const follow = shouldFollowSession(
            viewing,
            get().activeSessionId,
            healed.id,
          );
          // Clear pendingMode when agent confirms the requested mode.
          const pending = get().pendingMode ?? null;
          const modeConfirmed =
            pending !== null && healed.mode === pending;
          if (modeConfirmed) {
            clearPendingModeTimer();
          }
          set({
            catalog,
            activeSessionId: healed.id || get().activeSessionId,
            connectionMode: "live-bridge",
            lastError: null,
            ...(modeConfirmed ? { pendingMode: null } : {}),
            ...(follow
              ? {
                  session: healed,
                  viewingSessionId: healed.id || viewing,
                }
              : {}),
          });
          // Drain prompt queue when turn settles (F-STREAM-09).
          if (healed.status === "idle" && follow) {
            const queue = get().promptQueue;
            if (queue.length > 0) {
              const [next, ...rest] = queue;
              set({ promptQueue: rest });
              const sid = healed.id || get().activeSessionId;
              if (next && sid && get().live) {
                get().live?.prompt(next, sid);
              }
            }
          }
        },
        onPool: (entries) => {
          set({ poolEntries: entries });
        },
        onEnvironment: (env) => {
          set({
            environment: env,
            bridgeInfo: env.ok ? env.message : get().bridgeInfo,
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
        onRestartRequired: (payload) => {
          set({
            restartNotice: `${payload.setting}: ${payload.reason}`,
            bridgeInfo: payload.reason,
          });
        },
        onHello: (cwdHello, poolCapacity) => {
          const cap =
            poolCapacity !== undefined ? ` · pool≤${poolCapacity}` : "";
          set({ bridgeInfo: `live grok-build · cwd=${cwdHello}${cap}` });
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
              poolEntries: [],
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
      live.checkEnvironment();
      live.listPool();
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
