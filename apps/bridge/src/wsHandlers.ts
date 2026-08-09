/**
 * WebSocket client-message dispatch and session start/resume/restart lifecycle.
 * Owns focused-session + seed maps; server.ts only wires sockets and HTTP.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WebSocket } from "ws";
import type { SessionState } from "@grok-desktop/acp-core";
import { checkEnvironment } from "./environment.js";
import type { ClientMsg, ServerMsg } from "./protocol.js";
import { readWorkspaceFileForEmbed } from "./readWorkspaceFile.js";
import type { RuntimePool } from "./runtimePool.js";
import {
  createSessionRuntime,
  type SessionSpawnConfig,
} from "./sessionRuntime.js";
import { listWorkspaceEntries } from "./workspaceEntries.js";
import { resolveWorkspacePath } from "./workspacePath.js";
import {
  handleCli,
  handleSetMode,
  handleSetModel,
  handleTokenUsage,
  type SessionOpDeps,
} from "./wsSessionOps.js";

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
 * Mutable session focus + list-cwd + crash-recovery seeds shared by handlers.
 */
export type BridgeHandlerState = {
  focusedSessionId: string | null;
  defaultListCwd: string;
};

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
    const id = sessionId || state.focusedSessionId;
    if (!id) {
      throw new Error("session not started");
    }
    const rt = pool.get(id);
    if (!rt) {
      throw new Error(`session not in pool: ${id}`);
    }
    return rt;
  }

  /**
   * acquire / start: touch if already in pool; otherwise spawn + handshake and insert.
   * @param opts forceNew / resumeId / seed / cwd / alwaysApprove / spawnConfig.
   */
  async function startOrResume(opts: {
    cwd: string;
    alwaysApprove: boolean;
    resumeId?: string;
    seed?: SessionState;
    forceNew?: boolean;
    spawnConfig?: SessionSpawnConfig;
  }): Promise<void> {
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
          void startOrResume({
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
   * @param sessionId Existing ACP id.
   * @param spawnConfig New SPAWN flags.
   * @param approve Permission flag.
   */
  async function restartSession(
    sessionId: string,
    spawnConfig: SessionSpawnConfig | undefined,
    approve: boolean,
  ): Promise<void> {
    const existing = pool.get(sessionId);
    const seed = existing?.getSessionState() ?? sessionSeeds.get(sessionId);
    const cwd = existing?.cwd ?? seed?.workspace ?? state.defaultListCwd;
    const prevSpawn = existing?.spawnConfig;
    if (existing) {
      pool.close(sessionId);
    }
    await startOrResume({
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
      await dispatchClientMsg(ws, msg);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[bridge] error", message);
      send(ws, { type: "error", message });
      broadcast({ type: "error", message });
    }
  }

  /**
   * Handle one typed ClientMsg after JSON parse.
   * @param ws Source socket.
   * @param msg Parsed client message.
   */
  async function dispatchClientMsg(
    ws: WebSocket,
    msg: ClientMsg,
  ): Promise<void> {
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
    if (msg.type === "close_session") {
      const closed = pool.close(msg.sessionId);
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
      await startOrResume({
        cwd: msg.cwd ? path.resolve(msg.cwd) : state.defaultListCwd || defaultCwd,
        alwaysApprove: msg.alwaysApprove ?? alwaysApprove,
        resumeId: msg.forceNew ? undefined : msg.resumeId,
        seed: msg.forceNew ? undefined : msg.seed,
        forceNew: msg.forceNew,
        spawnConfig: msg.spawnConfig,
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
        msg.sessionId,
        msg.spawnConfig,
        msg.alwaysApprove ?? alwaysApprove,
      );
      return;
    }
    if (msg.type === "cli") {
      await handleCli(opDeps, ws, msg);
    }
  }

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

  return {
    state,
    onClientMessage,
    broadcastPool,
  };
}
