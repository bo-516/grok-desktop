/**
 * Session start/resume/restart + crash-recovery lifecycle for the bridge.
 * Owns focused-session seed bookkeeping shared with the client-message dispatcher.
 * Pure lifecycle — no ClientMsg type switch (that lives in wsClientDispatch).
 */

import path from "node:path";
import type { SessionState } from "@grok-desktop/acp-core";
import type { ServerMsg } from "./protocol.js";
import type { RuntimePool } from "./runtimePool.js";
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

  const runtime = await createSessionRuntime({
    cwd,
    alwaysApprove: opts.alwaysApprove,
    resumeId: opts.forceNew ? undefined : opts.resumeId,
    seed: opts.forceNew ? undefined : opts.seed,
    spawnConfig: opts.spawnConfig,
    onState: (session) => {
      if (session.id) {
        sessionSeeds.set(session.id, session);
      }
      broadcast({ type: "state", session });
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

  pool.insert(runtime);
  state.focusedSessionId = runtime.sessionId;
  sessionSeeds.set(runtime.sessionId, runtime.getSessionState());
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
