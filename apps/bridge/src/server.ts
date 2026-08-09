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
import type { ServerMsg } from "./protocol.js";
import { RuntimePool } from "./runtimePool.js";
import { createBridgeHandlers } from "./wsHandlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_CWD = path.resolve(REPO_ROOT, "demo");
const PORT = Number(process.env.BRIDGE_PORT ?? 8765);
const CWD = process.env.BRIDGE_CWD ?? DEFAULT_CWD;
const ALWAYS_APPROVE = process.env.BRIDGE_ALWAYS_APPROVE === "1";
const POOL_CAPACITY = poolCapacityFromEnv();

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

const server = http.createServer((_req, res) => {
  void (async () => {
    const env = await checkEnvironment(POOL_CAPACITY);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        service: "grok-desktop-bridge",
        cwd: handlers.state.defaultListCwd,
        ws: `ws://127.0.0.1:${PORT}`,
        focusedSessionId: handlers.state.focusedSessionId,
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
    cwd: handlers.state.defaultListCwd,
    port: PORT,
    poolCapacity: POOL_CAPACITY,
  });
  send(ws, { type: "pool", entries: pool.list() });
  const focused = handlers.state.focusedSessionId;
  if (focused && pool.has(focused)) {
    const rt = pool.get(focused);
    if (rt) {
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
