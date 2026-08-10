/**
 * Integration: drive the real HTTP/WS server entry with token + Origin checks.
 * Spawns server.ts as a child so verifyClient and hello.impl are the shipped path.
 */

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const BRIDGE_SRC = path.resolve(__dirname, "../src/server.ts");
const TSX_BIN = path.resolve(REPO_ROOT, "node_modules/.bin/tsx");
const TOKEN = "test-ws-auth-token-m0";

/**
 * Pick a free loopback port.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        s.close();
        reject(new Error("no port"));
        return;
      }
      const p = addr.port;
      s.close(() => resolve(p));
    });
  });
}

/**
 * Wait for the machine-readable `[bridge] ready {...}` line on stderr.
 * @param child Bridge process.
 * @param timeoutMs Fail after this many ms.
 */
function waitReady(
  child: ChildProcess,
  timeoutMs = 20_000,
): Promise<{ port: number; token: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("bridge ready timeout"));
    }, timeoutMs);
    let buf = "";
    const onData = (chunk: Buffer | string) => {
      buf += String(chunk);
      const m = /\[bridge\] ready ({.*})/.exec(buf);
      if (!m) {
        return;
      }
      clearTimeout(timer);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      try {
        const j = JSON.parse(m[1]!) as { port: number; token: string };
        resolve(j);
      } catch (e) {
        reject(e);
      }
    };
    const onExit = (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`bridge exited early code=${code}\n${buf}`));
    };
    child.stderr?.on("data", onData);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", onExit);
  });
}

/**
 * Expect a WebSocket upgrade to fail with the given status (or any error close).
 * @param url WS URL.
 * @param opts Optional Origin header.
 * @param expectStatus Expected HTTP status when unexpected-response fires.
 */
function expectReject(
  url: string,
  opts: { origin?: string; expectStatus?: number },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, opts.origin ? { origin: opts.origin } : undefined);
    let settled = false;
    const done = (ok: boolean, err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      if (ok) {
        resolve();
      } else {
        reject(err ?? new Error("fail"));
      }
    };
    ws.on("open", () => done(false, new Error(`opened unexpectedly: ${url}`)));
    ws.on("unexpected-response", (_req, res) => {
      if (
        opts.expectStatus !== undefined &&
        res.statusCode !== opts.expectStatus
      ) {
        res.resume();
        done(
          false,
          new Error(`status ${res.statusCode} expected ${opts.expectStatus}`),
        );
        return;
      }
      res.resume();
      done(true);
    });
    ws.on("error", () => done(true));
    setTimeout(() => done(false, new Error("reject timeout")), 8000);
  });
}

describe("shipped bridge WS auth (server.ts)", () => {
  let child: ChildProcess | null = null;
  let port = 0;

  before(async () => {
    port = await freePort();
    child = spawn(TSX_BIN, [BRIDGE_SRC], {
      env: {
        ...process.env,
        BRIDGE_PORT: String(port),
        BRIDGE_TOKEN: TOKEN,
        BRIDGE_ALLOWED_ORIGINS: "http://localhost:5173,null",
        BRIDGE_CWD: path.resolve(REPO_ROOT, "demo"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const ready = await waitReady(child);
    assert.equal(ready.port, port);
    assert.equal(ready.token, TOKEN);
  });

  after(() => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  });

  it("rejects connection without token", async () => {
    await expectReject(`ws://127.0.0.1:${port}`, { expectStatus: 401 });
  });

  it("rejects wrong token", async () => {
    await expectReject(`ws://127.0.0.1:${port}?token=wrong`, {
      expectStatus: 401,
    });
  });

  it("rejects illegal Origin with good token", async () => {
    await expectReject(`ws://127.0.0.1:${port}?token=${TOKEN}`, {
      origin: "https://evil.example",
      expectStatus: 403,
    });
  });

  it("accepts valid token and receives hello with impl=node", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${TOKEN}`, {
        origin: "http://localhost:5173",
      });
      const timer = setTimeout(() => {
        try {
          ws.terminate();
        } catch {
          /* ignore */
        }
        reject(new Error("hello timeout"));
      }, 10_000);
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(String(data)) as {
            type?: string;
            impl?: string;
            version?: string;
            port?: number;
          };
          if (msg.type !== "hello") {
            return;
          }
          clearTimeout(timer);
          assert.equal(msg.impl, "node");
          assert.ok(msg.version);
          assert.equal(msg.port, port);
          ws.close();
          resolve();
        } catch (e) {
          clearTimeout(timer);
          reject(e);
        }
      });
      ws.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
  });
});
