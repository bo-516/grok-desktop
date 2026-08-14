/**
 * Live bridge connect/start (multi-session): pool state, env probe, canvas follows viewing.
 * Real grok-build bridge only; no mock path.
 * Inbound paint/persist lives in sessionStoreLiveInbound.
 * Pool poll / pending flush / sessions_list sync are sibling modules.
 */

import { markDisconnected } from "@grok-desktop/acp-core";
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
  admitForceNewSessionFromInfo,
  type GetState,
  type SetState,
} from "./sessionStoreLiveInbound";
import { applyLiveInboundSession } from "./sessionStoreLiveApply";
import { forgetAllTurnEdges } from "./sessionTurnEdge";
import {
  applyPoolBusyToSession,
  poolFingerprintUnchanged,
  retargetPoolPoll,
  startPoolPoll,
  stopPoolPoll,
} from "./sessionStorePoolPoll";
import {
  cancelPendingSessionsSync,
  flushPendingSessionsToCatalog,
  schedulePendingSessionsSync as schedulePendingSyncImpl,
} from "./sessionStorePending";
import { hydrateViewingSessionFromDisk } from "./sessionStoreHistory";
import { syncCatalogFromBridge } from "./sessionStoreSync";
import { sessionHasConversationContent } from "@/lib/sessionContent";
import { rememberSlashCatalog } from "@/lib/slashCatalog";
import {
  persistNormalizedCatalog,
  resolveResumeCanvasStatus,
  resolveResumeTarget,
  type StartOpts,
} from "./sessionStoreSupport";
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
  type InboundOutcome,
  type LiveStoreSlice,
} from "./sessionStoreLiveInbound";

export { applyLiveInboundSession } from "./sessionStoreLiveApply";

export {
  POOL_POLL_ACTIVE_MS,
  POOL_POLL_IDLE_MS,
  POOL_POLL_MS,
  applyPoolBusyToSession,
  poolEntriesFingerprint,
  poolHasStreaming,
  retargetPoolPoll,
  startPoolPoll,
  stopPoolPoll,
} from "./sessionStorePoolPoll";

export {
  PENDING_SYNC_QUIET_MS,
  cancelPendingSessionsSync,
  flushPendingSessionsToCatalog,
} from "./sessionStorePending";

export { syncCatalogFromBridge } from "./sessionStoreSync";

export type { ConnectionMode, LiveHandle } from "./sessionStoreLiveTypes";

/** Product UI path never auto-approves tools by default. */
export const DEFAULT_ALWAYS_APPROVE = false;

/**
 * Schedule deferred sessions_list when pending buffers are non-empty.
 * @param bridge Live handle.
 * @param set Zustand set.
 * @param get Zustand get.
 */
export function schedulePendingSessionsSync(
  bridge: LiveHandle,
  set: SetState,
  get: GetState,
): void {
  // Casts keep pending module free of LiveStoreSlice import cycles.
  schedulePendingSyncImpl(
    bridge,
    set as never,
    get as never,
    syncCatalogFromBridge as never,
  );
}

/**
 * Connect to the real bridge and start/resume a session (pool acquire).
 * `connectOnly` stops after the WebSocket + env/pool sync — no session/start.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param opts Start options including optional post-await `guard` (T3)
 *   and `connectOnly` for automatic reconnect without session/new.
 */
export async function startLiveBridgeSession(
  set: SetState,
  get: GetState,
  opts?: StartOpts,
): Promise<void> {
  /** True when we only need the WebSocket (auto-retry / draft). */
  const connectOnly = Boolean(opts?.connectOnly);
  const resolved = resolveResumeTarget(get(), opts);
  const resumeId = connectOnly ? undefined : resolved.resumeId;
  const seed = connectOnly ? undefined : (resolved.seed ?? opts?.seed);
  const cwd = resolved.cwd ?? opts?.cwd;
  const forceNew = connectOnly ? false : Boolean(opts?.forceNew);
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
        onState: (session, meta) => {
          rememberSlashCatalog(session.availableCommands);
          applyLiveInboundSession(set, get, session, meta);
          const b = get().live;
          if (b && Object.keys(get().pendingSessions ?? {}).length > 0) {
            schedulePendingSessionsSync(b, set, get);
          }
        },
        onSessionUpdate: (session, meta) => {
          if (!meta.applied) {
            return;
          }
          rememberSlashCatalog(session.availableCommands);
          applyLiveInboundSession(set, get, session);
          const b = get().live;
          if (b && Object.keys(get().pendingSessions ?? {}).length > 0) {
            schedulePendingSessionsSync(b, set, get);
          }
        },
        onPool: (entries) => {
          if (poolFingerprintUnchanged(entries)) {
            return;
          }
          set((s) => ({
            poolEntries: entries,
            // Reconnect / select often seeds idle before list_pool lands.
            // Promote Working when the viewed process is still busy.
            session: applyPoolBusyToSession(
              s.session,
              s.viewingSessionId,
              entries,
              s.restoringSessionId,
            ),
          }));
          const bridge = get().live;
          if (bridge) {
            retargetPoolPoll(() => bridge.listPool(), entries);
          }
        },
        onEnvironment: (env) => {
          set({
            environment: env,
            bridgeInfo: env.ok ? env.message : get().bridgeInfo,
          });
        },
        onInfo: (message, sessionId) => {
          set({ bridgeInfo: message, lastError: null });
          // forceNew: stamp local only for ready contract
          // `session <id> ready` (+ optional models=…). Recovery/ops info with
          // a sessionId must not become sticky local mid-forceNew.
          admitForceNewSessionFromInfo(set, get, sessionId, message);
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
          cancelPendingSessionsSync();
          forgetAllTurnEdges();
          set((s) => {
            // Flush unproven pending first so multi-client sessions are not lost.
            const pendingFlush = flushPendingSessionsToCatalog(
              s.catalog,
              s.pendingSessions ?? {},
              s.sessionProvenance ?? {},
            );
            let catalog = pendingFlush.catalog;
            if (s.session.id) {
              catalog = normalizeCatalog(
                upsertFromLiveState(catalog, {
                  ...s.session,
                  status: "disconnected",
                }),
              );
            }
            persistNormalizedCatalog(catalog);
            return {
              live: null,
              connectionMode: "disconnected" as const,
              catalog,
              sessionProvenance: pendingFlush.provenance,
              pendingSessions: {},
              pendingSessionOrder: [],
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
      // Event-driven onPool is primary; adaptive poll keeps streaming "N running"
      // honest if a push is missed (stream end / exit without ACP, partial WS drop).
      startPoolPoll(() => bridge.listPool(), () => get().poolEntries);
      // Pull every workspace's sessions into the rail catalog (F-SESS-07).
      void syncCatalogFromBridge(bridge, set, get).then(() => {
        // After cold sync, reclassify any pending that arrived during connect.
        schedulePendingSessionsSync(bridge, set, get);
      });
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

  // Auto-reconnect / draft: WebSocket is enough. session/start would
  // resume catalog[0] or forceNew a ghost chat the user did not send.
  if (connectOnly) {
    set({
      connectionMode: "live-bridge",
      bridgeInfo: "live · connected",
    });
    return;
  }

  // Cold resume: paint disk history before spawning grok-build so Restoring
  // is not gated on initialize / MCP / session/load replay.
  if (resumeId && !forceNew) {
    const viewing = get().session;
    const needsHistory =
      viewing.id === resumeId &&
      !sessionHasConversationContent(viewing.timeline);
    if (needsHistory) {
      await hydrateViewingSessionFromDisk(set as never, get as never, {
        sessionId: resumeId,
        cwd: cwd || viewing.workspace || undefined,
        guard: stillCurrent,
        live,
      });
      if (!stillCurrent()) {
        return;
      }
    }
  }

  const paintedAfterHydrate = get().session;
  const keepDiskBody =
    Boolean(resumeId) &&
    paintedAfterHydrate.id === resumeId &&
    sessionHasConversationContent(paintedAfterHydrate.timeline);
  if (seed && resumeId && !keepDiskBody) {
    const poolStatus = get().poolEntries.find(
      (entry) => entry.sessionId === resumeId && entry.live,
    )?.status;
    const status = resolveResumeCanvasStatus(seed.status, poolStatus);
    set({
      session: {
        ...seed,
        status,
        pendingPermission:
          status === "waiting_permission"
            ? seed.pendingPermission
            : undefined,
      },
      viewingSessionId: resumeId,
      activeSessionId: resumeId,
    });
  } else if (resumeId) {
    set({ viewingSessionId: resumeId, activeSessionId: resumeId });
  }

  const painted = get().session;
  const seedForStart =
    !forceNew &&
    resumeId &&
    painted.id === resumeId &&
    sessionHasConversationContent(painted.timeline)
      ? painted
      : seed;
  const startOpts: BridgeStartOpts = {
    alwaysApprove,
    cwd,
    resumeId: forceNew ? undefined : resumeId,
    seed: forceNew ? undefined : seedForStart,
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
