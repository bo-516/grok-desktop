/**
 * Session start/resume/restart + crash-recovery lifecycle for the bridge.
 * Owns focused-session seed bookkeeping shared with the client-message dispatcher.
 * Pure lifecycle — no ClientMsg type switch (that lives in wsClientDispatch).
 *
 * Relay freeze: hot-path ACP updates go out as session_update; full `state` is
 * only for hydrate (start/reconnect) and lifecycle side channels when
 * status/permission/model/mode change without a timeline-only delta.
 */

import path from "node:path";
import type { SessionState } from "@grok-desktop/acp-core";
import type { ServerMsg } from "./protocol.js";
import type { RuntimePool } from "./runtimePool.js";
import { createSessionReplayGate } from "./sessionReplayGate.js";
import {
  createSessionRuntime,
  type SessionSpawnConfig,
} from "./sessionRuntime.js";
import type { BridgeHandlerState } from "./wsHandlerTypes.js";

/** Closures the lifecycle layer needs from createBridgeHandlers. */
export type SessionLifecycleDeps = {
  pool: RuntimePool;
  alwaysApprove: boolean;
  state: BridgeHandlerState;
  sessionSeeds: Map<string, SessionState>;
  broadcast: (msg: ServerMsg) => void;
  broadcastPool: () => void;
};

/** Last lifecycle snapshot fields used to suppress hot-path full-state broadcasts. */
type LifecycleFingerprint = {
  status: SessionState["status"];
  permKey: string;
  model: string;
  mode: SessionState["mode"];
  id: string;
};

/**
 * Fingerprint of non-timeline fields that warrant a lifecycle/state push.
 * @param session Current SessionState.
 */
function lifecycleFingerprint(session: SessionState): LifecycleFingerprint {
  const perm = session.pendingPermission;
  const permKey = perm
    ? `${String(perm.requestId)}:${perm.toolCall?.toolCallId ?? ""}`
    : "";
  return {
    status: session.status,
    permKey,
    model: session.model,
    mode: session.mode,
    id: session.id,
  };
}

/**
 * Whether non-timeline lifecycle fields changed enough to notify UIs.
 * Timeline / toolCalls growth alone must NOT force a full `state` broadcast.
 * @param prev Previous fingerprint, or undefined on first observation.
 * @param next Current fingerprint.
 */
function lifecycleChanged(
  prev: LifecycleFingerprint | undefined,
  next: LifecycleFingerprint,
): boolean {
  if (!prev) {
    return true;
  }
  return (
    prev.status !== next.status ||
    prev.permKey !== next.permKey ||
    prev.model !== next.model ||
    prev.mode !== next.mode ||
    prev.id !== next.id
  );
}

/**
 * acquire / start: touch if already in pool; otherwise spawn + handshake and insert.
 * Unexpected agent exit triggers seed-based session/load recovery (F-OPS-04).
 * @param deps Pool, focus state, seed map, and broadcast closures.
 * @param opts forceNew / resumeId / seed / cwd / alwaysApprove / spawnConfig.
 */
export async function startOrResume(
  deps: SessionLifecycleDeps,
  opts: {
    cwd: string;
    alwaysApprove: boolean;
    resumeId?: string;
    seed?: SessionState;
    forceNew?: boolean;
    spawnConfig?: SessionSpawnConfig;
  },
): Promise<void> {
  const { pool, alwaysApprove, state, sessionSeeds, broadcast, broadcastPool } =
    deps;
  const cwd = path.resolve(opts.cwd);
  state.defaultListCwd = cwd;

  // Resume already in pool: zero spawn; background stream continues.
  if (opts.resumeId && !opts.forceNew && pool.has(opts.resumeId)) {
    const rt = pool.get(opts.resumeId);
    if (rt) {
      pool.touch(opts.resumeId);
      state.focusedSessionId = opts.resumeId;
      broadcast({ type: "state", session: rt.getSessionState() });
      broadcast({
        type: "info",
        message: `already live on ${opts.resumeId}`,
        sessionId: opts.resumeId,
      });
      broadcastPool();
      return;
    }
  }

  // No forceNew/resumeId: reuse focused live if present to avoid ghost session/new.
  if (
    !opts.forceNew &&
    !opts.resumeId &&
    state.focusedSessionId &&
    pool.has(state.focusedSessionId)
  ) {
    const focused = state.focusedSessionId;
    const rt = pool.get(focused);
    if (rt) {
      pool.touch(focused);
      broadcast({ type: "state", session: rt.getSessionState() });
      broadcast({
        type: "info",
        message: `reuse live ${focused}`,
        sessionId: focused,
      });
      broadcastPool();
      return;
    }
  }

  /** Per-session last lifecycle fingerprint so timeline-only deltas stay quiet. */
  const lastLifecycle = new Map<string, LifecycleFingerprint>();
  /** Load-replay WS framing (begin / silent / end) for this runtime. */
  const replayGate = createSessionReplayGate(broadcast);

  // Reserve capacity before spawn so concurrent start/recovery cannot overshoot.
  // When the pool is full and all busy, waits for a free/idle slot (no throw).
  await pool.beginSpawn();
  let runtime;
  try {
    runtime = await createSessionRuntime({
      cwd,
      alwaysApprove: opts.alwaysApprove,
      resumeId: opts.forceNew ? undefined : opts.resumeId,
      seed: opts.forceNew ? undefined : opts.seed,
      spawnConfig: opts.spawnConfig,
      onReplayChange: (on, sessionId) => {
        replayGate.onReplayChange(on, sessionId || opts.resumeId || "");
      },
      onSessionUpdate: (update, sessionId, eventId) => {
        replayGate.onSessionUpdate(update, sessionId, eventId);
      },
      onState: (session) => {
        if (session.id) {
          sessionSeeds.set(session.id, session);
        }
        // replay_end or silent mid-window — skip normal lifecycle fan-out.
        if (replayGate.onState(session)) {
          if (session.id) {
            lastLifecycle.set(session.id, lifecycleFingerprint(session));
          }
          // Pool lights after a finished load.
          if (session.id && !replayGate.isReplaying(session.id)) {
            broadcastPool();
          }
          return;
        }
        const fp = lifecycleFingerprint(session);
        const prev = session.id ? lastLifecycle.get(session.id) : undefined;
        const changed = lifecycleChanged(prev, fp);
        if (session.id) {
          lastLifecycle.set(session.id, fp);
        }
        if (!changed) {
          // Timeline-only growth: skip full state and skip pool spam.
          return;
        }
        // Lifecycle side channel (status / permission / model / mode / id).
        const needsFullState =
          !prev ||
          prev.id !== fp.id ||
          Boolean(session.pendingPermission) ||
          (prev.permKey !== "" && fp.permKey === "");
        if (needsFullState) {
          broadcast({ type: "state", session });
        } else {
          broadcast({
            type: "session_lifecycle",
            sessionId: session.id,
            status: session.status,
            pendingPermission: session.pendingPermission ?? null,
            model: session.model,
            mode: session.mode,
          });
        }
        broadcastPool();
      },
      onStderr: (text, sessionId) => {
        broadcast({ type: "stderr", text, sessionId });
      },
      onInfo: (message, sessionId) => {
        broadcast({ type: "info", message, sessionId });
      },
      onProcessExit: (sessionId, code) => {
        if (!sessionId) {
          return;
        }
        // F-OPS-04: unexpected exit → close + auto session/load recovery with seed.
        if (pool.has(sessionId)) {
          const seed = sessionSeeds.get(sessionId);
          const spawnConfig = pool.get(sessionId)?.spawnConfig;
          const exitCwd =
            pool.get(sessionId)?.cwd ?? seed?.workspace ?? state.defaultListCwd;
          pool.close(sessionId);
          lastLifecycle.delete(sessionId);
          if (state.focusedSessionId === sessionId) {
            state.focusedSessionId = null;
          }
          broadcast({
            type: "info",
            message: `agent process exited (code ${code}); recovering via session/load…`,
            sessionId,
          });
          broadcastPool();
          void startOrResume(deps, {
            cwd: exitCwd,
            alwaysApprove,
            resumeId: sessionId,
            seed,
            forceNew: false,
            spawnConfig,
          }).catch((e) => {
            if (state.focusedSessionId === sessionId) {
              state.focusedSessionId = null;
            }
            broadcast({
              type: "error",
              message: `crash recovery failed: ${e instanceof Error ? e.message : String(e)}`,
              sessionId,
            });
            broadcastPool();
          });
        }
      },
    });
  } catch (e) {
    pool.cancelSpawn();
    throw e;
  }

  await pool.insert(runtime);
  state.focusedSessionId = runtime.sessionId;
  const initial = runtime.getSessionState();
  sessionSeeds.set(runtime.sessionId, initial);
  // One-shot hydrate after spawn/handshake (and optional session/load).
  lastLifecycle.set(runtime.sessionId, lifecycleFingerprint(initial));
  broadcast({ type: "state", session: initial });
  broadcastPool();
}

/**
 * Restart a session process with new SPAWN config, then session/load (J-06).
 * @param deps Lifecycle deps (pool + seeds + broadcast).
 * @param sessionId Existing ACP id.
 * @param spawnConfig New SPAWN flags.
 * @param approve Permission flag.
 */
export async function restartSession(
  deps: SessionLifecycleDeps,
  sessionId: string,
  spawnConfig: SessionSpawnConfig | undefined,
  approve: boolean,
): Promise<void> {
  const { pool, state, sessionSeeds, broadcast } = deps;
  const existing = pool.get(sessionId);
  const seed = existing?.getSessionState() ?? sessionSeeds.get(sessionId);
  const cwd = existing?.cwd ?? seed?.workspace ?? state.defaultListCwd;
  const prevSpawn = existing?.spawnConfig;
  if (existing) {
    pool.close(sessionId);
  }
  await startOrResume(deps, {
    cwd,
    alwaysApprove: approve,
    resumeId: sessionId,
    seed,
    forceNew: false,
    spawnConfig: spawnConfig ?? prevSpawn,
  });
  broadcast({
    type: "info",
    message: `restarted session ${sessionId} with updated SPAWN settings`,
    sessionId,
  });
}

/**
 * Resolve the target session for prompt/cancel/permission.
 * @param pool Runtime pool.
 * @param focusedSessionId Current focus; used when sessionId is omitted.
 * @param sessionId Optional explicit id.
 * @returns Runtime in the pool.
 * @throws When no matching session exists.
 */
export function requireSessionRuntime(
  pool: RuntimePool,
  focusedSessionId: string | null,
  sessionId?: string,
) {
  const id = sessionId || focusedSessionId;
  if (!id) {
    throw new Error("session not started");
  }
  const rt = pool.get(id);
  if (!rt) {
    throw new Error(`session not in pool: ${id}`);
  }
  return rt;
}
