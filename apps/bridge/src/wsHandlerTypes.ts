/**
 * Shared types for bridge WebSocket handlers (factory, lifecycle, dispatch).
 * Kept free of runtime imports so lifecycle/dispatch can share state without cycles.
 */

import type { WebSocket } from "ws";
import type { ServerMsg } from "./protocol.js";
import type { RuntimePool } from "./runtimePool.js";

/** Dependencies injected from the bridge server process. */
export type BridgeHandlerDeps = {
  pool: RuntimePool;
  /** Env BRIDGE_ALWAYS_APPROVE. */
  alwaysApprove: boolean;
  /** Initial / env default cwd. */
  defaultCwd: string;
  poolCapacity: number;
  send: (ws: WebSocket, msg: ServerMsg) => void;
  broadcast: (msg: ServerMsg) => void;
};

/**
 * Mutable session focus + list-cwd shared by handlers.
 * Crash-recovery seeds live in a separate Map owned by createBridgeHandlers.
 */
export type BridgeHandlerState = {
  focusedSessionId: string | null;
  defaultListCwd: string;
};
