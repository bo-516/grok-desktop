#!/usr/bin/env node
/**
 * Bridge bench: RSS/CPU samples for Node and Go, plus WS serialization model
 * for pre-relay vs post-relay outbound bytes.
 *
 * Usage:
 *   node scripts/bench-bridge.mjs [--out path.csv]
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const TSX = path.join(REPO, "node_modules/.bin/tsx");
const NODE_SERVER = path.join(REPO, "apps/bridge/src/server.ts");
const GO_BIN = path.join(REPO, "apps/bridge-go/bin/bridge-go");
const DEMO = path.join(REPO, "demo");

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
const outPath = flag(
  "--out",
  path.join(REPO, "docs", "bench-bridge-last.csv"),
);
const updateCount = Number(flag("--updates", "495"));

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") {
        s.close();
        reject(new Error("no port"));
        return;
      }
      const p = a.port;
      s.close(() => resolve(p));
    });
  });
}

function rssKb(pid) {
  try {
    const out = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf8" }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

/** macOS: %CPU from ps; single sample. */
function cpuPct(pid) {
  try {
    const out = execSync(`ps -o %cpu= -p ${pid}`, { encoding: "utf8" }).trim();
    return Number(out) || 0;
  } catch {
    return 0;
  }
}

function waitReady(child, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ready timeout")), timeoutMs);
    let buf = "";
    child.stderr.on("data", (c) => {
      buf += String(c);
      const m = /\[bridge\] ready ({.*})/.exec(buf);
      if (m) {
        clearTimeout(t);
        resolve(JSON.parse(m[1]));
      }
    });
    child.on("exit", (code) => {
      clearTimeout(t);
      reject(new Error(`exit ${code}: ${buf}`));
    });
  });
}

async function spawnImpl(impl) {
  const port = await freePort();
  const token = `bench-${impl}-${Date.now()}`;
  const env = {
    ...process.env,
    BRIDGE_PORT: String(port),
    BRIDGE_TOKEN: token,
    BRIDGE_CWD: DEMO,
    BRIDGE_ALLOWED_ORIGINS: "null",
  };
  const child =
    impl === "node"
      ? spawn(TSX, [NODE_SERVER], { env, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(GO_BIN, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  const ready = await waitReady(child);
  return {
    impl,
    child,
    pid: child.pid,
    url: `ws://127.0.0.1:${ready.port}?token=${encodeURIComponent(ready.token)}`,
    ready,
  };
}

function connectHello(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let bytes = 0;
    let msgs = 0;
    const t = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* */
      }
      reject(new Error("hello timeout"));
    }, 10000);
    ws.on("message", (d) => {
      bytes += Buffer.byteLength(String(d), "utf8");
      msgs += 1;
      try {
        const m = JSON.parse(String(d));
        if (m.type === "hello") {
          clearTimeout(t);
          ws.close();
          resolve({ bytes, msgs, impl: m.impl });
        }
      } catch {
        /* */
      }
    });
    ws.on("error", reject);
  });
}

/** Simulated stream serialization cost (pre-relay full state vs post-relay updates). */
function simulateStreamBytes(n, strategy) {
  let bytes = 0;
  let msgs = 0;
  if (strategy === "post-relay") {
    for (let i = 0; i < n; i++) {
      const msg = {
        type: "session_update",
        sessionId: "bench-session",
        eventId: `bench-session-${i}`,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `chunk-${i}-` + "x".repeat(32) },
        },
      };
      bytes += Buffer.byteLength(JSON.stringify(msg), "utf8");
      msgs += 1;
    }
  } else {
    const timeline = [];
    for (let i = 0; i < n; i++) {
      timeline.push({
        kind: "agent",
        id: `a${i}`,
        text: `chunk-${i}-` + "x".repeat(32),
      });
      const stateMsg = {
        type: "state",
        session: {
          id: "bench-session",
          workspace: "/demo",
          model: "grok",
          mode: "build",
          status: "streaming",
          timeline: [...timeline],
          toolCalls: {},
          lastAgentText: timeline.map((t) => t.text).join(""),
        },
      };
      bytes += Buffer.byteLength(JSON.stringify(stateMsg), "utf8");
      msgs += 1;
    }
  }
  return { bytes, msgs };
}

/**
 * Light streaming sample: start session + short prompt, sample RSS/CPU mid-stream.
 */
function sampleStreaming(bridge) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(bridge.url);
    let sid = null;
    const samples = [];
    const t = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* */
      }
      resolve({ samples, sid });
    }, 45000);
    const tick = () => {
      samples.push({
        t: Date.now(),
        rssKb: rssKb(bridge.pid),
        cpuPct: cpuPct(bridge.pid),
      });
    };
    const interval = setInterval(tick, 500);
    ws.on("message", (d) => {
      const m = JSON.parse(String(d));
      if (m.type === "state" && m.session?.id && !sid) {
        sid = m.session.id;
        ws.send(
          JSON.stringify({
            type: "prompt",
            sessionId: sid,
            text: "Write a 40-word paragraph about bridges. No tools.",
          }),
        );
        tick();
      }
      if (
        sid &&
        m.type === "session_update" &&
        samples.length >= 3
      ) {
        // collect a few more samples then finish
      }
      if (
        sid &&
        ((m.type === "session_lifecycle" && m.status === "idle") ||
          (m.type === "state" && m.session?.status === "idle"))
      ) {
        tick();
        clearInterval(interval);
        clearTimeout(t);
        try {
          ws.close();
        } catch {
          /* */
        }
        resolve({ samples, sid });
      }
    });
    ws.on("open", () => {
      tick();
      ws.send(
        JSON.stringify({
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        }),
      );
    });
    ws.on("error", (e) => {
      clearInterval(interval);
      clearTimeout(t);
      reject(e);
    });
  });
}

async function main() {
  const rows = [
    "impl,phase,rss_kb,cpu_pct,sim_outbound_bytes_495,sim_outbound_msgs,hello_inbound_bytes,notes",
  ];
  const pre = simulateStreamBytes(updateCount, "pre-relay");
  const post = simulateStreamBytes(updateCount, "post-relay");
  rows.push(
    [
      "sim",
      "pre-relay",
      "",
      "",
      pre.bytes,
      pre.msgs,
      "",
      "full SessionState per update O(n^2)",
    ].join(","),
  );
  rows.push(
    [
      "sim",
      "post-relay",
      "",
      "",
      post.bytes,
      post.msgs,
      "",
      "session_update O(n)",
    ].join(","),
  );

  for (const impl of ["node", "go"]) {
    if (impl === "go" && !existsSync(GO_BIN)) {
      rows.push([impl, "missing", "", "", "", "", "", "binary not built"].join(","));
      continue;
    }
    let b;
    try {
      b = await spawnImpl(impl);
      const idleRss = rssKb(b.pid);
      const idleCpu = cpuPct(b.pid);
      const hello = await connectHello(b.url);
      rows.push(
        [
          impl,
          "idle",
          idleRss,
          idleCpu,
          post.bytes,
          post.msgs,
          hello.bytes,
          `hello.impl=${hello.impl}`,
        ].join(","),
      );
      const stream = await sampleStreaming(b);
      const peakRss = Math.max(...stream.samples.map((s) => s.rssKb), idleRss);
      const peakCpu = Math.max(...stream.samples.map((s) => s.cpuPct), idleCpu);
      const mid =
        stream.samples[Math.floor(stream.samples.length / 2)] || {
          rssKb: idleRss,
          cpuPct: idleCpu,
        };
      rows.push(
        [
          impl,
          "streaming",
          mid.rssKb,
          mid.cpuPct,
          post.bytes,
          post.msgs,
          "",
          `samples=${stream.samples.length} peakRss=${peakRss} peakCpu=${peakCpu}`,
        ].join(","),
      );
    } finally {
      try {
        b?.child?.kill("SIGTERM");
      } catch {
        /* */
      }
    }
  }

  const csv = rows.join("\n") + "\n";
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, csv, "utf8");
  console.log(csv);
  console.error(`[bench] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
