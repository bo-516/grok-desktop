/**
 * Typed ClientMsg → handler map for the bridge WebSocket.
 * Keeps createBridgeHandlers free of a long if-chain; each case is one branch.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebSocket } from "ws";
import { checkEnvironment } from "./environment.js";
import type { ClientMsg, ServerMsg } from "./protocol.js";
import {
  readWorkspaceFileForEmbed,
  readWorkspaceFileForPreview,
} from "./readWorkspaceFile.js";
import type { PooledRuntime, RuntimePool } from "./runtimePool.js";
import type { SessionSpawnConfig } from "./sessionRuntime.js";
import { listWorkspaceEntries } from "./workspaceEntries.js";
import { resolveWorkspacePath } from "./workspacePath.js";
import type { BridgeHandlerState } from "./wsHandlerTypes.js";
import {
  restartSession,
  startOrResume,
  type SessionLifecycleDeps,
} from "./wsSessionLifecycle.js";
import {
  handleCli,
  handleSetMode,
  handleSetModel,
  handleTokenUsage,
  type SessionOpDeps,
} from "./wsSessionOps.js";

/** Closures the dispatcher needs from createBridgeHandlers. */
export type ClientDispatchDeps = {
  pool: RuntimePool;
  alwaysApprove: boolean;
  defaultCwd: string;
  poolCapacity: number;
  state: BridgeHandlerState;
  send: (ws: WebSocket, msg: ServerMsg) => void;
  broadcast: (msg: ServerMsg) => void;
  broadcastPool: () => void;
  lifecycle: SessionLifecycleDeps;
  opDeps: SessionOpDeps;
  /**
   * Resolve a pooled runtime. Missing sessionId uses focused session.
   * @throws When no matching session exists.
   */
  requireRuntime: (sessionId?: string) => PooledRuntime;
};

/**
 * Handle one typed ClientMsg after JSON parse.
 * @param deps Pool, focus state, lifecycle, and session-op closures.
 * @param ws Source socket (workspace_entries / cli_result go only here).
 * @param msg Parsed client message.
 */
export async function dispatchClientMsg(
  deps: ClientDispatchDeps,
  ws: WebSocket,
  msg: ClientMsg,
): Promise<void> {
  const {
    pool,
    alwaysApprove,
    defaultCwd,
    poolCapacity,
    state,
    send,
    broadcastPool,
    lifecycle,
    opDeps,
    requireRuntime,
  } = deps;

  if (msg.type === "ping") {
    send(ws, { type: "pong" });
    return;
  }
  if (msg.type === "check_environment") {
    const env = await checkEnvironment(poolCapacity);
    send(ws, { type: "environment", env });
    return;
  }
  if (msg.type === "list_pool") {
    send(ws, { type: "pool", entries: pool.list() });
    return;
  }
  if (msg.type === "get_state") {
    // On-demand full snapshot (reconnect / multi-window); not the streaming path.
    try {
      const rt = requireRuntime(msg.sessionId);
      send(ws, { type: "state", session: rt.getSessionState() });
    } catch (e) {
      send(ws, {
        type: "error",
        message: e instanceof Error ? e.message : String(e),
        sessionId: msg.sessionId,
      });
    }
    return;
  }
  if (msg.type === "list_workspace_entries") {
    const listCwd = msg.cwd ? path.resolve(msg.cwd) : state.defaultListCwd;
    const entries = await listWorkspaceEntries(listCwd, msg.query);
    send(ws, {
      type: "workspace_entries",
      requestId: msg.requestId,
      entries,
    });
    return;
  }
  if (msg.type === "write_workspace_file") {
    try {
      const writeCwd = msg.cwd ? path.resolve(msg.cwd) : state.defaultListCwd;
      const abs = resolveWorkspacePath(writeCwd, msg.path);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, msg.content, "utf8");
      send(ws, {
        type: "write_workspace_file_result",
        requestId: msg.requestId,
        ok: true,
      });
    } catch (e) {
      send(ws, {
        type: "write_workspace_file_result",
        requestId: msg.requestId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }
  if (msg.type === "read_workspace_file") {
    const readCwd = msg.cwd ? path.resolve(msg.cwd) : state.defaultListCwd;
    const result = await readWorkspaceFileForEmbed(readCwd, msg.path);
    send(ws, {
      type: "read_workspace_file_result",
      requestId: msg.requestId,
      ok: result.ok,
      content: result.content,
      mimeType: result.mimeType,
      bytes: result.bytes,
      reason: result.reason,
      error: result.error,
    });
    return;
  }
  if (msg.type === "preview_workspace_file") {
    const readCwd = msg.cwd ? path.resolve(msg.cwd) : state.defaultListCwd;
    const maxBytes =
      typeof msg.maxBytes === "number" ? msg.maxBytes : undefined;
    const result = await readWorkspaceFileForPreview(
      readCwd,
      msg.path,
      maxBytes,
    );
    send(ws, {
      type: "preview_workspace_file_result",
      requestId: msg.requestId,
      ok: result.ok,
      content: result.content,
      mimeType: result.mimeType,
      bytes: result.bytes,
      truncated: result.truncated,
      reason: result.reason,
      error: result.error,
    });
    return;
  }
  if (msg.type === "close_session") {
    const closed = pool.close(msg.sessionId);
    // Drop crash-recovery seed so long-running bridges do not retain timelines forever.
    deps.lifecycle.sessionSeeds.delete(msg.sessionId);
    if (state.focusedSessionId === msg.sessionId) {
      state.focusedSessionId = pool.list().at(-1)?.sessionId ?? null;
    }
    send(ws, {
      type: "info",
      message: closed
        ? `closed session ${msg.sessionId}`
        : `session not in pool: ${msg.sessionId}`,
      sessionId: msg.sessionId,
    });
    broadcastPool();
    return;
  }
  if (msg.type === "start") {
    await startOrResume(lifecycle, {
      cwd: msg.cwd ? path.resolve(msg.cwd) : state.defaultListCwd || defaultCwd,
      alwaysApprove: msg.alwaysApprove ?? alwaysApprove,
      resumeId: msg.forceNew ? undefined : msg.resumeId,
      seed: msg.forceNew ? undefined : msg.seed,
      forceNew: msg.forceNew,
      spawnConfig: msg.spawnConfig as SessionSpawnConfig | undefined,
    });
    return;
  }
  if (msg.type === "prompt") {
    const rt = requireRuntime(msg.sessionId);
    pool.touch(rt.sessionId);
    state.focusedSessionId = rt.sessionId;
    await rt.prompt(msg.text, msg.blocks);
    return;
  }
  if (msg.type === "cancel") {
    const rt = requireRuntime(msg.sessionId);
    pool.touch(rt.sessionId);
    rt.cancel();
    return;
  }
  if (msg.type === "permission") {
    const rt = requireRuntime(msg.sessionId);
    pool.touch(rt.sessionId);
    rt.respondPermission(msg.optionId);
    return;
  }
  if (msg.type === "set_model") {
    await handleSetModel(opDeps, ws, msg.sessionId, msg.modelId);
    return;
  }
  if (msg.type === "set_mode") {
    await handleSetMode(opDeps, ws, msg.sessionId, msg.modeId);
    return;
  }
  if (msg.type === "compact") {
    const rt = requireRuntime(msg.sessionId);
    pool.touch(rt.sessionId);
    if (!rt.compact) {
      throw new Error("compact not available");
    }
    await rt.compact(msg.instruction);
    return;
  }
  if (msg.type === "token_usage") {
    await handleTokenUsage(opDeps, ws, msg.sessionId, msg.requestId);
    return;
  }
  if (msg.type === "restart_session") {
    await restartSession(
      lifecycle,
      msg.sessionId,
      msg.spawnConfig as SessionSpawnConfig | undefined,
      msg.alwaysApprove ?? alwaysApprove,
    );
    return;
  }
  if (msg.type === "cli") {
    await handleCli(opDeps, ws, msg);
  }
}
