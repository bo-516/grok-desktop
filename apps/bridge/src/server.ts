/**
 * Local desktop bridge: RuntimePool of real `grok agent stdio` + WebSocket API.
 * Multi-session parallel: one process per session; idle LRU reclaim; check_environment probes CLI/login.
 * CLI channel (inspect/sessions/mcp/worktree) and mid-session set_model/set_mode/restart.
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  checkEnvironment,
  poolCapacityFromEnv,
} from "./environment.js";
import type { SessionState } from "@grok-desktop/acp-core";
import { dispatchCliCommand } from "./cliDispatch.js";
import type { ClientMsg, ServerMsg } from "./protocol.js";
import { RuntimePool } from "./runtimePool.js";
import {
  createSessionRuntime,
  type SessionSpawnConfig,
} from "./sessionRuntime.js";
import { listWorkspaceEntries } from "./workspaceEntries.js";
import { resolveWorkspacePath } from "./workspacePath.js";
import { mkdir, writeFile } from "node:fs/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_CWD = path.resolve(REPO_ROOT, "demo");
const PORT = Number(process.env.BRIDGE_PORT ?? 8765);
const CWD = process.env.BRIDGE_CWD ?? DEFAULT_CWD;
const ALWAYS_APPROVE = process.env.BRIDGE_ALWAYS_APPROVE === "1";
const POOL_CAPACITY = poolCapacityFromEnv();

const pool = new RuntimePool(POOL_CAPACITY);
/** Last successfully started session; for legacy clients that omit sessionId. */
let focusedSessionId: string | null = null;
/** Default cwd for list_workspace_entries. */
let defaultListCwd = CWD;
/** Last known seed per session for crash recovery. */
const sessionSeeds = new Map<string, SessionState>();
const sockets = new Set<WebSocket>();

/**
 * Broadcast to all connected UIs.
 * @param msg ServerMsg.
 */
function broadcast(msg: ServerMsg): void {
  const raw = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(raw);
    }
  }
}

/**
 * Unicast to a specific WebSocket.
 * @param ws Connection.
 * @param msg Message.
 */
function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

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
  defaultListCwd = cwd;

  // Resume already in pool: zero spawn; background stream continues.
  if (opts.resumeId && !opts.forceNew && pool.has(opts.resumeId)) {
    const rt = pool.get(opts.resumeId);
    if (rt) {
      pool.touch(opts.resumeId);
      focusedSessionId = opts.resumeId;
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
    focusedSessionId &&
    pool.has(focusedSessionId)
  ) {
    const rt = pool.get(focusedSessionId);
    if (rt) {
      pool.touch(focusedSessionId);
      broadcast({ type: "state", session: rt.getSessionState() });
      broadcast({
        type: "info",
        message: `reuse live ${focusedSessionId}`,
        sessionId: focusedSessionId,
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
        const cwd = pool.get(sessionId)?.cwd ?? seed?.workspace ?? defaultListCwd;
        pool.close(sessionId);
        broadcast({
          type: "info",
          message: `agent process exited (code ${code}); recovering via session/load…`,
          sessionId,
        });
        broadcastPool();
        void startOrResume({
          cwd,
          alwaysApprove: ALWAYS_APPROVE,
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
  focusedSessionId = runtime.sessionId;
  sessionSeeds.set(runtime.sessionId, runtime.getSessionState());
  broadcastPool();
}

/**
 * Restart a session process with new SPAWN config, then session/load (J-06).
 * @param sessionId Existing ACP id.
 * @param spawnConfig New SPAWN flags.
 * @param alwaysApprove Permission flag.
 */
async function restartSession(
  sessionId: string,
  spawnConfig: SessionSpawnConfig | undefined,
  alwaysApprove: boolean,
): Promise<void> {
  const existing = pool.get(sessionId);
  const seed = existing?.getSessionState() ?? sessionSeeds.get(sessionId);
  const cwd = existing?.cwd ?? seed?.workspace ?? defaultListCwd;
  const prevSpawn = existing?.spawnConfig;
  if (existing) {
    pool.close(sessionId);
  }
  await startOrResume({
    cwd,
    alwaysApprove,
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
    if (msg.type === "ping") {
      send(ws, { type: "pong" });
      return;
    }
    if (msg.type === "check_environment") {
      const env = await checkEnvironment(POOL_CAPACITY);
      send(ws, { type: "environment", env });
      return;
    }
    if (msg.type === "list_pool") {
      send(ws, { type: "pool", entries: pool.list() });
      return;
    }
    if (msg.type === "list_workspace_entries") {
      const listCwd = msg.cwd ? path.resolve(msg.cwd) : defaultListCwd;
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
        const writeCwd = msg.cwd ? path.resolve(msg.cwd) : defaultListCwd;
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
    if (msg.type === "close_session") {
      const closed = pool.close(msg.sessionId);
      if (focusedSessionId === msg.sessionId) {
        focusedSessionId = pool.list().at(-1)?.sessionId ?? null;
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
        cwd: msg.cwd ? path.resolve(msg.cwd) : defaultListCwd || CWD,
        alwaysApprove: msg.alwaysApprove ?? ALWAYS_APPROVE,
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
      focusedSessionId = rt.sessionId;
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
      const rt = requireRuntime(msg.sessionId);
      pool.touch(rt.sessionId);
      if (!rt.setModel) {
        throw new Error("set_model not available on runtime");
      }
      try {
        await rt.setModel(msg.modelId);
        send(ws, {
          type: "info",
          message: `model set to ${msg.modelId}`,
          sessionId: rt.sessionId,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        // SPAWN fallback path: notify UI that restart is required (J-06).
        if (/method not|not found|-32601/i.test(errMsg)) {
          send(ws, {
            type: "restart_required",
            sessionId: rt.sessionId,
            reason:
              "session/set_model is not supported by this agent; restart with --model to apply",
            setting: "model",
          });
        }
        throw e;
      }
      return;
    }
    if (msg.type === "set_mode") {
      const rt = requireRuntime(msg.sessionId);
      pool.touch(rt.sessionId);
      if (!rt.setMode) {
        throw new Error("set_mode not available on runtime");
      }
      try {
        await rt.setMode(msg.modeId);
        send(ws, {
          type: "info",
          message: `mode set to ${msg.modeId}`,
          sessionId: rt.sessionId,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (/method not|not found|-32601/i.test(errMsg)) {
          send(ws, {
            type: "restart_required",
            sessionId: rt.sessionId,
            reason:
              "session/set_mode is not supported; restart with --permission-mode to apply",
            setting: "mode",
          });
        }
        throw e;
      }
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
      const rt = requireRuntime(msg.sessionId);
      pool.touch(rt.sessionId);
      if (!rt.tokenUsage) {
        send(ws, {
          type: "cli_result",
          result: {
            requestId: msg.requestId,
            ok: false,
            error: "token_usage not available",
          },
        });
        return;
      }
      try {
        const data = await rt.tokenUsage();
        send(ws, {
          type: "cli_result",
          result: { requestId: msg.requestId, ok: true, data },
        });
      } catch (e) {
        send(ws, {
          type: "cli_result",
          result: {
            requestId: msg.requestId,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
      return;
    }
    if (msg.type === "restart_session") {
      await restartSession(
        msg.sessionId,
        msg.spawnConfig,
        msg.alwaysApprove ?? ALWAYS_APPROVE,
      );
      return;
    }
    if (msg.type === "cli") {
      try {
        const data = await dispatchCliCommand(
          msg.command,
          msg.args ?? {},
          msg.cwd ? path.resolve(msg.cwd) : defaultListCwd,
        );
        // Logout must kill all runtimes (F-AUTH-07).
        if (msg.command === "auth_logout") {
          pool.disposeAll();
          focusedSessionId = null;
          broadcastPool();
        }
        send(ws, {
          type: "cli_result",
          result: { requestId: msg.requestId, ok: true, data },
        });
      } catch (e) {
        send(ws, {
          type: "cli_result",
          result: {
            requestId: msg.requestId,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          },
        });
      }
      return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[bridge] error", message);
    send(ws, { type: "error", message });
    broadcast({ type: "error", message });
  }
}

const server = http.createServer((_req, res) => {
  void (async () => {
    const env = await checkEnvironment(POOL_CAPACITY);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "grok-desktop-bridge",
        cwd: defaultListCwd,
        ws: `ws://127.0.0.1:${PORT}`,
        focusedSessionId,
        pool: { capacity: POOL_CAPACITY, entries: pool.list() },
        environment: env,
      }),
    );
  })();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  sockets.add(ws);
  send(ws, {
    type: "hello",
    cwd: defaultListCwd,
    port: PORT,
    poolCapacity: POOL_CAPACITY,
  });
  send(ws, { type: "pool", entries: pool.list() });
  if (focusedSessionId && pool.has(focusedSessionId)) {
    const rt = pool.get(focusedSessionId);
    if (rt) {
      send(ws, { type: "state", session: rt.getSessionState() });
    }
  }
  void checkEnvironment(POOL_CAPACITY).then((env) => {
    send(ws, { type: "environment", env });
  });
  ws.on("message", (data) => {
    void onClientMessage(ws, String(data));
  });
  ws.on("close", () => {
    sockets.delete(ws);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(
    `[bridge] listening http://127.0.0.1:${PORT} cwd=${CWD} pool=${POOL_CAPACITY} alwaysApprove=${ALWAYS_APPROVE}`,
  );
});

process.on("SIGINT", () => {
  pool.disposeAll();
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  pool.disposeAll();
  server.close();
  process.exit(0);
});
