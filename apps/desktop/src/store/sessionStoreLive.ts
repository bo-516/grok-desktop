/**
 * Live bridge connect/start (multi-session): pool state, env probe, canvas follows viewing.
 * Real grok-build bridge only; no mock path.
 * Inbound paint/persist lives in sessionStoreLiveInbound.
 */

import { markDisconnected } from "@grok-desktop/acp-core";
import {
  connectLiveBridge,
  defaultBridgeUrl,
  type StartOpts as BridgeStartOpts,
} from "../bridge/liveBridge";
import {
  mergeRemoteSessionsIntoCatalog,
  normalizeSessionsList,
} from "../lib/sessionActions";
import {
  normalizeCatalog,
  upsertFromLiveState,
} from "./sessionCatalog";
import {
  persistNormalizedCatalog,
  resolveResumeTarget,
  type StartOpts,
} from "./sessionStoreSupport";
import {
  applyInboundSession,
  type GetState,
  type SetState,
} from "./sessionStoreLiveInbound";
import type { LiveHandle } from "./sessionStoreLiveTypes";

export {
  mergeCanvasInbound,
  mergeOptimisticLocalUsers,
  preserveLocalUserMedia,
  resolveCanvasFollow,
  shouldFollowSession,
} from "./sessionStoreLiveFollow";

export {
  applyInboundSession,
  healSessionTimeline,
  type LiveStoreSlice,
} from "./sessionStoreLiveInbound";

export type { ConnectionMode, LiveHandle } from "./sessionStoreLiveTypes";

/** Product UI path never auto-approves tools by default. */
export const DEFAULT_ALWAYS_APPROVE = false;

/**
 * Footer "N running" safety poll while live-bridge is up.
 * "Running" = pool entries with `status === "streaming"` (AI outputting),
 * not mere process residency. Primary updates are event-driven (`onPool` /
 * `broadcastPool`); this interval covers missed events / process death without
 * ACP notification. 1s matches the rail status freshness expectation.
 */
export const POOL_POLL_MS = 1000;

/** Active pool list_pool timer; null when disconnected. */
let poolPollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Stop the 1s list_pool poll (disconnect / reconnect / close).
 * Safe when no timer is running.
 */
export function stopPoolPoll(): void {
  if (poolPollTimer !== null) {
    clearInterval(poolPollTimer);
    poolPollTimer = null;
  }
}

/**
 * Start (or restart) the 1s list_pool poll so footer streaming counts stay fresh.
 * @param listPool Bridge client method; return value ignored (false = WS closed).
 */
export function startPoolPoll(listPool: () => boolean): void {
  stopPoolPoll();
  poolPollTimer = setInterval(() => {
    listPool();
  }, POOL_POLL_MS);
}

/**
 * Connect to the real bridge and start/resume a session (pool acquire).
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Start options including optional post-await `guard` (T3).
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

  /** Post-await guard: false means a later select superseded this start. */
  const stillCurrent = (): boolean => opts?.guard?.() ?? true;

  const prev = get().session;
  if (prev.id && prev.timeline.length > 0) {
    const catalog = normalizeCatalog(
      upsertFromLiveState(get().catalog, prev),
    );
    persistNormalizedCatalog(catalog);
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
        /**
         * Shared paint path for full hydrate `state` and post-reduce relay
         * `session_update` / `session_lifecycle` messages.
         * @param session SessionState already reduced / hydrated.
         */
        onState: (session) => {
          applyInboundSession(set, get, session);
        },
        onSessionUpdate: (session, meta) => {
          if (!meta.applied) {
            return;
          }
          applyInboundSession(set, get, session);
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
        onHello: (cwdHello, poolCapacity, meta) => {
          const cap =
            poolCapacity !== undefined ? ` · pool≤${poolCapacity}` : "";
          const impl =
            meta?.impl !== undefined
              ? ` · bridge=${meta.impl}${meta.version ? `@${meta.version}` : ""}`
              : "";
          set({
            bridgeInfo: `live grok-build · cwd=${cwdHello}${cap}${impl}`,
          });
        },
        onClose: () => {
          stopPoolPoll();
          set((s) => {
            const catalog = s.session.id
              ? normalizeCatalog(
                  upsertFromLiveState(s.catalog, {
                    ...s.session,
                    status: "disconnected",
                  }),
                )
              : s.catalog;
            if (s.session.id) {
              persistNormalizedCatalog(catalog);
            }
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
      // Stale select: do not touch canvas / start after a later selection won.
      if (!stillCurrent()) {
        return;
      }
      live.checkEnvironment();
      live.listPool();
      // Capture non-null handle for the interval closure (TS + reconnect safety).
      const bridge = live;
      // Event-driven onPool is primary; 1s poll keeps streaming "N running"
      // honest if a push is missed (stream end / exit without ACP, partial WS drop).
      startPoolPoll(() => bridge.listPool());
      // Pull every workspace's sessions into the rail catalog (F-SESS-07).
      void syncCatalogFromBridge(bridge, set, get);
    } catch (e) {
      stopPoolPoll();
      if (!stillCurrent()) {
        throw e;
      }
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

  if (!stillCurrent()) {
    return;
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
    stopPoolPoll();
    if (!stillCurrent()) {
      throw new Error("bridge WebSocket not open");
    }
    set({
      connectionMode: "disconnected",
      lastError: "WebSocket not connected",
      bridgeInfo: "Cannot write to bridge — run npm run bridge and retry",
    });
    throw new Error("bridge WebSocket not open");
  }

  if (!stillCurrent()) {
    return;
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

/**
 * Fetch upstream sessions (all workspaces) and merge into the local catalog.
 * Used on connect and by the Sync sessions menu. Empty remote does not clear
 * local rows. Failures are silent so a flaky CLI does not block the UI.
 * @param bridge Live bridge handle with `cli`.
 * @param set Zustand set for catalog write-back.
 * @param get Zustand get for the current catalog snapshot.
 */
export async function syncCatalogFromBridge(
  bridge: LiveHandle,
  set: SetState,
  get: GetState,
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    // Omit cwd so the bridge returns every workspace under ~/.grok/sessions.
    const result = await bridge.cli("sessions_list", {});
    if (!result.ok) {
      return {
        ok: false,
        count: 0,
        error: result.error ?? "sessions_list failed",
      };
    }
    const rows = normalizeSessionsList(result.data);
    // mergeRemoteSessionsIntoCatalog already ends with normalizeCatalog.
    const catalog = mergeRemoteSessionsIntoCatalog(get().catalog, rows);
    persistNormalizedCatalog(catalog);
    set({ catalog });
    return { ok: true, count: rows.length };
  } catch (e) {
    return {
      ok: false,
      count: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

