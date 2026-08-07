/**
 * Local desktop bridge: real `grok agent stdio` + WebSocket API for the Vite UI.
 *
 * Supports session/new and session/load (resume) so UI can continue history
 * like grok-build.
 *
 * Default workspace: <repo>/demo
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  AcpClient,
  type SessionState,
} from "@grok-desktop/acp-core";
import { spawnGrokAgent } from "./spawnGrok.js";
import {
  listWorkspaceEntries,
  type WorkspaceEntry,
} from "./workspaceEntries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEFAULT_CWD = path.resolve(REPO_ROOT, "demo");
const PORT = Number(process.env.BRIDGE_PORT ?? 8765);
const CWD = process.env.BRIDGE_CWD ?? DEFAULT_CWD;
const ALWAYS_APPROVE = process.env.BRIDGE_ALWAYS_APPROVE === "1";

type ClientMsg =
  | {
      type: "start";
      cwd?: string;
      alwaysApprove?: boolean;
      /** Resume via session/load (same as grok-build). */
      resumeId?: string;
      /** Optional cached session snapshot for immediate UI. */
      seed?: SessionState;
      /** Explicit new chat — only then call session/new. */
      forceNew?: boolean;
    }
  | { type: "prompt"; text: string }
  | { type: "cancel" }
  | { type: "permission"; optionId: string }
  /** Browser requests `@` completion entries for the real workspace; does not start agent or mock paths. */
  | { type: "list_workspace_entries"; requestId: string; query: string }
  | { type: "ping" };

type ServerMsg =
  | { type: "hello"; cwd: string; port: number }
  | { type: "state"; session: SessionState }
  | { type: "stderr"; text: string }
  | { type: "error"; message: string }
  | { type: "info"; message: string }
  /** Snapshot of real workspace entries for the matching requestId. */
  | { type: "workspace_entries"; requestId: string; entries: WorkspaceEntry[] }
  | { type: "pong" };

let client: AcpClient | null = null;
let disposeSpawn: (() => void) | null = null;
let currentCwd = CWD;
const sockets = new Set<WebSocket>();

function broadcast(msg: ServerMsg): void {
  const raw = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {ws.send(raw);}
  }
}

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) {ws.send(JSON.stringify(msg));}
}

async function startSession(opts: {
  cwd: string;
  alwaysApprove: boolean;
  resumeId?: string;
  seed?: SessionState;
}): Promise<void> {
  disposeSpawn?.();
  client?.dispose();
  client = null;
  disposeSpawn = null;
  currentCwd = opts.cwd;

  const spawned = spawnGrokAgent({
    cwd: opts.cwd,
    alwaysApprove: opts.alwaysApprove,
  });
  disposeSpawn = spawned.dispose;

  client = new AcpClient({
    transport: spawned.transport,
    settleQuietMs: 300,
    autoPermissionOptionId: opts.alwaysApprove ? "allow_once" : null,
    onStateChange: (session) => {
      broadcast({ type: "state", session });
    },
    onStderr: (text) => {
      process.stderr.write(text);
      broadcast({ type: "stderr", text });
    },
    onAgentRequest: async (method, _id, params) => {
      if (method === "fs/read_text_file") {
        const p = params as { path?: string };
        const { readFile } = await import("node:fs/promises");
        const abs = path.resolve(opts.cwd, p.path ?? "");
        if (!abs.startsWith(opts.cwd)) {
          throw new Error("path outside workspace");
        }
        const text = await readFile(abs, "utf8");
        return { content: text };
      }
      if (method === "fs/write_text_file") {
        const p = params as { path?: string; content?: string };
        const { writeFile, mkdir } = await import("node:fs/promises");
        const abs = path.resolve(opts.cwd, p.path ?? "");
        if (!abs.startsWith(opts.cwd)) {
          throw new Error("path outside workspace");
        }
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, p.content ?? "", "utf8");
        return {};
      }
      return {};
    },
  });

  // Seed local cache first so UI can show history while load runs.
  if (opts.seed && opts.resumeId && opts.seed.id === opts.resumeId) {
    client.replaceSessionState({
      ...opts.seed,
      workspace: opts.cwd,
      status: "idle",
      pendingPermission: undefined,
    });
    broadcast({ type: "state", session: client.getSessionState() });
  }

  const { sessionId, init, resumed } = await client.handshake({
    cwd: opts.cwd,
    resumeId: opts.resumeId,
    seed: opts.seed,
    envApiKeyPresent: Boolean(process.env.XAI_API_KEY),
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: false,
    },
  });

  broadcast({
    type: "info",
    message: resumed
      ? `resumed session ${sessionId}`
      : `session ${sessionId} ready (models=${JSON.stringify(
          (init.availableModels ?? []).map((m) => m.id),
        )})`,
  });
  broadcast({ type: "state", session: client.getSessionState() });
}

/**
 * Dispatch browser bridge messages to real grok-build or current workspace reads.
 * @param ws WebSocket that sent the request; file lists go only to this connection to avoid cross-window leakage.
 * @param raw Unparsed JSON text; invalid JSON returns error and does not affect other clients.
 * @returns No value after the request finishes; agent/filesystem errors become bridge error messages.
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
    if (msg.type === "list_workspace_entries") {
      const entries = await listWorkspaceEntries(currentCwd, msg.query);
      send(ws, { type: "workspace_entries", requestId: msg.requestId, entries });
      return;
    }
    if (msg.type === "start") {
      // Fast path: already on this live session — just push state.
      if (
        msg.resumeId &&
        client &&
        client.getSessionState().id === msg.resumeId
      ) {
        broadcast({ type: "state", session: client.getSessionState() });
        broadcast({
          type: "info",
          message: `already live on ${msg.resumeId}`,
        });
        return;
      }
      // Without forceNew/resumeId: if agent already running, re-broadcast
      // instead of spawning another session/new (prevents ghost chats).
      if (
        !msg.forceNew &&
        !msg.resumeId &&
        client &&
        client.getSessionState().id
      ) {
        broadcast({ type: "state", session: client.getSessionState() });
        broadcast({
          type: "info",
          message: `reuse live ${client.getSessionState().id}`,
        });
        return;
      }
      await startSession({
        cwd: msg.cwd ? path.resolve(msg.cwd) : currentCwd || CWD,
        alwaysApprove: msg.alwaysApprove ?? ALWAYS_APPROVE,
        resumeId: msg.forceNew ? undefined : msg.resumeId,
        seed: msg.forceNew ? undefined : msg.seed,
      });
      return;
    }
    if (msg.type === "prompt") {
      if (!client) {throw new Error("session not started");}
      const sid = client.getSessionState().id;
      await client.prompt(sid, [{ type: "text", text: msg.text }]);
      return;
    }
    if (msg.type === "cancel") {
      if (!client) {return;}
      client.cancel(client.getSessionState().id);
      return;
    }
    if (msg.type === "permission") {
      if (!client) {throw new Error("session not started");}
      client.respondPermission(msg.optionId);
      
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[bridge] error", message);
    send(ws, { type: "error", message });
    broadcast({ type: "error", message });
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      ok: true,
      service: "grok-desktop-bridge",
      cwd: currentCwd,
      ws: `ws://127.0.0.1:${PORT}`,
      activeSessionId: client?.getSessionState().id ?? null,
    }),
  );
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  sockets.add(ws);
  send(ws, { type: "hello", cwd: currentCwd, port: PORT });
  if (client) {
    send(ws, { type: "state", session: client.getSessionState() });
  }
  ws.on("message", (data) => {
    void onClientMessage(ws, String(data));
  });
  ws.on("close", () => {
    sockets.delete(ws);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(
    `[bridge] listening http://127.0.0.1:${PORT} cwd=${CWD} alwaysApprove=${ALWAYS_APPROVE}`,
  );
});

process.on("SIGINT", () => {
  disposeSpawn?.();
  client?.dispose();
  server.close();
  process.exit(0);
});
