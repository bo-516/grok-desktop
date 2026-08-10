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
  mergeRemoteSessionsIntoCatalog,
  normalizeSessionsList,
} from "../lib/sessionActions";
import { loadWorkspacePrefs } from "../lib/workspacePrefs";
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
import {
  mergeOptimisticLocalUsers,
  resolveCanvasFollow,
} from "./sessionStoreLiveFollow";

export {
  mergeOptimisticLocalUsers,
  resolveCanvasFollow,
  shouldFollowSession,
} from "./sessionStoreLiveFollow";

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
   * True after New chat until first send or selectSession.
   * Optional so older call sites still type-check.
   */
  localDraft?: boolean;
  /**
   * True while first send of a New chat draft is forceNew-creating.
   * Optional so older call sites still type-check.
   */
  creatingSession?: boolean;
  /**
   * In-flight mode switch target; cleared when inbound session.mode matches.
   * Optional so older call sites still type-check.
   */
  pendingMode?: AgentMode | null;
  /**
   * Uncached session waiting for session/load replay to land.
   * Optional so older call sites still type-check.
   */
  restoringSessionId?: string | null;
};

type SetState = (
  partial:
    | Partial<LiveStoreSlice>
    | ((state: LiveStoreSlice) => Partial<LiveStoreSlice>),
) => void;
type GetState = () => LiveStoreSlice;

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
 * Route one inbound SessionState (hydrate or post-reduce relay) into catalog + canvas.
 * Shared by full `state` and client-reduced `session_update` so both paths stay identical.
 * @param set Zustand set.
 * @param get Zustand get.
 * @param session SessionState after heal-ready reduce / hydrate.
 */
export function applyInboundSession(
  set: SetState,
  get: GetState,
  session: SessionState,
): void {
  /** Snapshot with legacy duplicate seed rows normalized before routing. */
  const healedTimeline = healSessionTimeline(session);
  // User chose "work without a project": bridge still has a default
  // cwd for the agent process, but do not let that overwrite the UI
  // selection or catalog grouping a few seconds later.
  const healed = loadWorkspacePrefs().noProject
    ? { ...healedTimeline, workspace: "" }
    : healedTimeline;
  /** Shared history receives every session, including background streams. */
  const catalog = normalizeCatalog(
    upsertFromLiveState(get().catalog, healed),
  );
  persistCatalog(catalog);
  /** Explicit rail selection; background pool snapshots must not replace it. */
  const viewing = get().viewingSessionId;
  /** Last canvas-owned live id, used only before an explicit selection exists. */
  const active = get().activeSessionId;
  /** Whether this inbound snapshot may update canvas-scoped state. */
  const follow = resolveCanvasFollow({
    viewing,
    active,
    localDraft: Boolean(get().localDraft),
    creatingSession: Boolean(get().creatingSession),
    inbound: healed,
  });
  // Mode requests belong to the painted chat; a background session
  // using the same mode must not acknowledge the foreground request.
  const pending = get().pendingMode ?? null;
  const modeConfirmed =
    follow && pending !== null && healed.mode === pending;
  if (modeConfirmed) {
    clearPendingModeTimer();
  }
  // Only a canvas-owned snapshot may promote activeSessionId. Keeping
  // background ids out prevents alternating streams from taking turns
  // satisfying the active fallback and repainting the selected chat.
  const nextActive = follow && healed.id ? healed.id : active;
  // forceNew empty paint must not wipe the optimistic user bubble
  // already shown on the draft canvas while create+prompt still runs.
  const canvasSession = follow
    ? mergeOptimisticLocalUsers(healed, get().session)
    : healed;
  // Replay landed: the first snapshot for this id that carries content
  // is the single post-load flush. A session that really is empty keeps
  // the hint until the user's first prompt fills the canvas — harmless,
  // and it never hides content that exists.
  const restoreDone =
    get().restoringSessionId === healed.id &&
    healed.timeline.length > 0;
  set({
    catalog,
    activeSessionId: nextActive,
    connectionMode: "live-bridge",
    lastError: null,
    ...(restoreDone ? { restoringSessionId: null } : {}),
    ...(modeConfirmed ? { pendingMode: null } : {}),
    ...(follow
      ? {
          session: canvasSession,
          viewingSessionId: healed.id || viewing,
          // Handshake painted the forceNew session — leave draft mode.
          ...(get().creatingSession && healed.id
            ? { creatingSession: false, localDraft: false }
            : {}),
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
      // Capture non-null handle for the interval closure (TS + reconnect safety).
      const bridge = live;
      // Event-driven onPool is primary; 1s poll keeps streaming "N running"
      // honest if a push is missed (stream end / exit without ACP, partial WS drop).
      startPoolPoll(() => bridge.listPool());
      // Pull every workspace's sessions into the rail catalog (F-SESS-07).
      void syncCatalogFromBridge(bridge, set, get);
    } catch (e) {
      stopPoolPoll();
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
    stopPoolPoll();
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
    const catalog = mergeRemoteSessionsIntoCatalog(get().catalog, rows);
    persistCatalog(catalog);
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
