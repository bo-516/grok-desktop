/**
 * Local desktop bridge: RuntimePool of real `grok agent stdio` + WebSocket API.
 * Multi-session parallel: one process per session; idle LRU reclaim; check_environment probes CLI/login.
 * CLI channel (inspect/sessions/mcp/worktree) and mid-session set_model/set_mode/restart.
 *
 * Auth: every WS connection must present a per-start token and pass Origin checks
 * (see wsAuth.ts). Port/token/origins are injectable via env for the shell launcher.
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  checkEnvironment,
  poolCapacityFromEnv,
} from "./environment.js";
import type { ServerMsg } from "./protocol.js";
import { RuntimePool } from "./runtimePool.js";
import {
  authorizeWsConnection,
  bridgeWsUrl,
  resolveAllowedOrigins,
  resolveBridgeToken,
  resolveListenPort,
} from "./wsAuth.js";
import { createBridgeHandlers } from "./wsHandlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_CWD = path.resolve(REPO_ROOT, "demo");
const PORT = resolveListenPort(process.env.BRIDGE_PORT);
const HOST = process.env.BRIDGE_HOST?.trim() || "127.0.0.1";
const CWD = process.env.BRIDGE_CWD ?? DEFAULT_CWD;
const ALWAYS_APPROVE = process.env.BRIDGE_ALWAYS_APPROVE === "1";
const POOL_CAPACITY = poolCapacityFromEnv();
const BRIDGE_TOKEN = resolveBridgeToken(process.env.BRIDGE_TOKEN);
const ALLOWED_ORIGINS = resolveAllowedOrigins(
  process.env.BRIDGE_ALLOWED_ORIGINS,
);
/** Product version advertised on hello for cold-switch observability. */
const BRIDGE_VERSION = "0.1.0";
const BRIDGE_IMPL = "node" as const;

const pool = new RuntimePool(POOL_CAPACITY);
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

const handlers = createBridgeHandlers({
  pool,
  alwaysApprove: ALWAYS_APPROVE,
  defaultCwd: CWD,
  poolCapacity: POOL_CAPACITY,
  send,
  broadcast,
});

const authConfig = {
  token: BRIDGE_TOKEN,
  allowedOrigins: ALLOWED_ORIGINS,
};

const server = http.createServer((req, res) => {
  // Health endpoint stays open (no secrets); WS is the privileged surface.
  void (async () => {
    const env = await checkEnvironment(POOL_CAPACITY);
    const addr = server.address();
    const port =
      addr && typeof addr === "object" ? addr.port : PORT;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "grok-desktop-bridge",
        impl: BRIDGE_IMPL,
        version: BRIDGE_VERSION,
        cwd: handlers.state.defaultListCwd,
        ws: `ws://${HOST}:${port}`,
        // Token is intentionally omitted from HTTP probe — only shell/env hold it.
        focusedSessionId: handlers.state.focusedSessionId,
        pool: { capacity: POOL_CAPACITY, entries: pool.list() },
        environment: env,
      }),
    );
  })();
});

const wss = new WebSocketServer({
  server,
  /**
   * Reject upgrade before the socket is accepted so browsers see a clean
   * HTTP 401/403 rather than a half-open WS that immediately closes.
   */
  verifyClient: (info, callback) => {
    const result = authorizeWsConnection(info.req, authConfig);
    if (result.ok) {
      callback(true);
      return;
    }
    callback(false, result.status, result.reason);
  },
});

wss.on("connection", (ws) => {
  sockets.add(ws);
  const addr = server.address();
  const port =
    addr && typeof addr === "object" ? addr.port : PORT;
  send(ws, {
    type: "hello",
    cwd: handlers.state.defaultListCwd,
    port,
    poolCapacity: POOL_CAPACITY,
    impl: BRIDGE_IMPL,
    version: BRIDGE_VERSION,
  });
  send(ws, { type: "pool", entries: pool.list() });
  const focused = handlers.state.focusedSessionId;
  if (focused && pool.has(focused)) {
    const rt = pool.get(focused);
    if (rt) {
      // Reconnect hydrate only — not a per-update broadcast.
      send(ws, { type: "state", session: rt.getSessionState() });
    }
  }
  void checkEnvironment(POOL_CAPACITY).then((env) => {
    send(ws, { type: "environment", env });
  });
  ws.on("message", (data) => {
    void handlers.onClientMessage(ws, String(data));
  });
  ws.on("close", () => {
    sockets.delete(ws);
  });
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const boundPort =
    addr && typeof addr === "object" ? addr.port : PORT;
  const url = bridgeWsUrl(boundPort, BRIDGE_TOKEN, HOST);
  console.error(
    `[bridge] listening http://${HOST}:${boundPort} cwd=${CWD} pool=${POOL_CAPACITY} alwaysApprove=${ALWAYS_APPROVE} impl=${BRIDGE_IMPL}`,
  );
  // Print once so shell / dev scripts can inject VITE_BRIDGE_URL without logging secrets elsewhere.
  console.error(`[bridge] ws=${url}`);
  // Machine-readable line for harnesses (token included; stderr only).
  console.error(
    `[bridge] ready ${JSON.stringify({
      host: HOST,
      port: boundPort,
      token: BRIDGE_TOKEN,
      impl: BRIDGE_IMPL,
      version: BRIDGE_VERSION,
    })}`,
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

/**
 * Last-resort guard: a ChildProcess without an `error` listener turns spawn
 * failures (ENOENT / EACCES / …) into process death. Terminal reverse and other
 * spawn sites should listen themselves; this keeps the bridge alive if one is
 * missed so a single bad agent shell line cannot take down all sessions.
 * Non-spawn uncaught exceptions still exit so real bugs stay visible.
 */
process.on("uncaughtException", (err) => {
  const e = err as NodeJS.ErrnoException;
  const syscall = typeof e.syscall === "string" ? e.syscall : "";
  const isSpawnFailure =
    syscall === "spawn" ||
    syscall.startsWith("spawn ") ||
    (typeof e.path === "string" && e.code === "ENOENT" && syscall.includes("spawn"));
  if (isSpawnFailure) {
    console.error(
      `[bridge] unhandled spawn failure (kept alive): ${e.message ?? String(err)}`,
    );
    return;
  }
  console.error("[bridge] uncaughtException", err);
  pool.disposeAll();
  process.exit(1);
});
