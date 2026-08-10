#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GO = path.join(REPO, "apps/bridge-go/bin/bridge-go");
const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
const port = await freePort();
const token = "go-e2e-" + Date.now();
const child = spawn(GO, [], {
  env: {
    ...process.env,
    BRIDGE_PORT: String(port),
    BRIDGE_TOKEN: token,
    BRIDGE_CWD: path.join(REPO, "demo"),
    BRIDGE_ALWAYS_APPROVE: "1",
    BRIDGE_ALLOWED_ORIGINS: "null",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("ready timeout")), 15000);
  let b = "";
  child.stderr.on("data", (c) => {
    b += String(c);
    if (b.includes("[bridge] ready")) {
      clearTimeout(t);
      resolve();
    }
  });
  child.on("exit", (c) => reject(new Error("exit " + c + " " + b)));
});
const url = `ws://127.0.0.1:${port}?token=${token}`;
const ws = new WebSocket(url);
const msgs = [];
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("hello timeout")), 10000);
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    if (m.type === "hello" && m.impl === "go") {
      clearTimeout(t);
      resolve();
    }
  });
  ws.on("error", reject);
});
ws.send(
  JSON.stringify({
    type: "start",
    cwd: path.join(REPO, "demo"),
    alwaysApprove: true,
    forceNew: true,
  }),
);
const sessionId = await new Promise((resolve, reject) => {
  const t = setTimeout(
    () =>
      reject(
        new Error("start timeout msgs=" + JSON.stringify(msgs.slice(-8))),
      ),
    120000,
  );
  const onMsg = (d) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    if (m.type === "state" && m.session?.id) {
      clearTimeout(t);
      ws.off("message", onMsg);
      resolve(m.session.id);
    }
    if (m.type === "error") console.error("bridge error", m.message);
  };
  ws.on("message", onMsg);
});
console.error("session", sessionId);
ws.send(
  JSON.stringify({
    type: "prompt",
    sessionId,
    text: "Reply with exactly: GO_BRIDGE_OK. No tools.",
  }),
);
let sawUpdate = false;
let agentBits = "";
await new Promise((resolve, reject) => {
  const t = setTimeout(
    () =>
      reject(
        new Error(
          "prompt timeout updates=" +
            sawUpdate +
            " text=" +
            agentBits.slice(0, 80),
        ),
      ),
    180000,
  );
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    if (m.type === "session_update") {
      sawUpdate = true;
      const u = m.update;
      if (u?.sessionUpdate === "agent_message_chunk" && u.content?.text) {
        agentBits += u.content.text;
      }
      if (agentBits.includes("GO_BRIDGE")) {
        clearTimeout(t);
        resolve();
      }
    }
    if (
      (m.type === "session_lifecycle" || m.type === "state") &&
      sawUpdate &&
      (m.status === "idle" || m.session?.status === "idle")
    ) {
      clearTimeout(t);
      resolve();
    }
  });
});
ws.send(JSON.stringify({ type: "set_model", sessionId, modelId: "x" }));
const t3 = await new Promise((resolve) => {
  const t = setTimeout(() => resolve(null), 5000);
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.type === "error" && /Node/i.test(m.message || "")) {
      clearTimeout(t);
      resolve(m.message);
    }
  });
});
const out = {
  ok: sawUpdate,
  sessionId,
  sawSessionUpdate: msgs.some((m) => m.type === "session_update"),
  agentSnippet: agentBits.slice(0, 160),
  t3Error: t3,
  types: [...new Set(msgs.map((m) => m.type))],
};
console.log(JSON.stringify(out, null, 2));
ws.close();
child.kill("SIGTERM");
process.exit(sawUpdate ? 0 : 1);
