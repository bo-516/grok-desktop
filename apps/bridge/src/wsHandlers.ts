/**
 * Bridge WebSocket handler factory: wires lifecycle + client dispatch.
 * Owns focused-session + seed maps; server.ts only wires sockets and HTTP.
 * Lifecycle lives in wsSessionLifecycle; typed dispatch in wsClientDispatch.
 */

import type { WebSocket } from "ws";
import type { SessionState } from "@grok-desktop/acp-core";
import type { ClientMsg } from "./protocol.js";
import {
  dispatchClientMsg,
  type ClientDispatchDeps,
} from "./wsClientDispatch.js";
import type {
  BridgeHandlerDeps,
  BridgeHandlerState,
} from "./wsHandlerTypes.js";
import {
  requireSessionRuntime,
  type SessionLifecycleDeps,
} from "./wsSessionLifecycle.js";
import type { SessionOpDeps } from "./wsSessionOps.js";

export type { BridgeHandlerDeps, BridgeHandlerState } from "./wsHandlerTypes.js";

/**
 * Builds start/resume/restart + onClientMessage bound to one pool and I/O pair.
 * @param deps Pool, env flags, and send/broadcast closures from server.ts.
 * @returns Handlers plus live state getters for hello / health endpoints.
 */
export function createBridgeHandlers(deps: BridgeHandlerDeps) {
  const { pool, alwaysApprove, defaultCwd, poolCapacity, send, broadcast } =
    deps;
  const state: BridgeHandlerState = {
    focusedSessionId: null,
    defaultListCwd: defaultCwd,
  };
  /** Last known seed per session for crash recovery. */
  const sessionSeeds = new Map<string, SessionState>();

  /** Broadcast the current pool summary. */
  function broadcastPool(): void {
    broadcast({ type: "pool", entries: pool.list() });
  }

  /**
   * Resolve the target session for prompt/cancel/permission.
   * @param sessionId Optional explicit id.
   * @returns Runtime in the pool.
   * @throws When no matching session exists.
   */
  function requireRuntime(sessionId?: string) {
    return requireSessionRuntime(pool, state.focusedSessionId, sessionId);
  }

  const lifecycle: SessionLifecycleDeps = {
    pool,
    alwaysApprove,
    state,
    sessionSeeds,
    broadcast,
    broadcastPool,
  };

  const opDeps: SessionOpDeps = {
    pool,
    send,
    requireRuntime,
    getDefaultListCwd: () => state.defaultListCwd,
    onAuthLogout: () => {
      pool.disposeAll();
      state.focusedSessionId = null;
      broadcastPool();
    },
  };

  const dispatchDeps: ClientDispatchDeps = {
    pool,
    alwaysApprove,
    defaultCwd,
    poolCapacity,
    state,
    send,
    broadcast,
    broadcastPool,
    lifecycle,
    opDeps,
    requireRuntime,
  };

  /**
   * Dispatch browser messages.
   * @param ws Source connection; workspace_entries / cli_result go only to this socket.
   * @param raw JSON text.
   */
  async function onClientMessage(ws: WebSocket, raw: string): Promise<void> {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      send(ws, { type: "error", message: "invalid JSON" });
      return;
    }

    try {
      await dispatchClientMsg(dispatchDeps, ws, msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[bridge] error", message);
      send(ws, { type: "error", message });
      broadcast({ type: "error", message });
    }
  }

  return {
    state,
    onClientMessage,
    broadcastPool,
  };
}
