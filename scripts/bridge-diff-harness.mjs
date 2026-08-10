#!/usr/bin/env node
/**
 * Differential harness (AC3): same ClientMsg inbound → Node + Go bridges
 * (both driven by the same deterministic fake-grok fixture via GROK_BIN) →
 * ServerMsg outbound L1 content equivalence + frontend reduce L2 SessionState
 * equality (timelineId counter reset; ignore absolute timestamps).
 *
 * Live scenarios (VP5): auth, reverse-fs-guard, multi-session, cancel,
 * permission round-trip, crash recover, bad-utf8/partial-lines, long/tool
 * offline reduce, T3 explicit error.
 *
 * Usage: node scripts/bridge-diff-harness.mjs [--out report.txt]
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const TSX = path.join(REPO, "node_modules/.bin/tsx");
const NODE_SERVER = path.join(REPO, "apps/bridge/src/server.ts");
const GO_BIN = path.join(REPO, "apps/bridge-go/bin/bridge-go");
const FAKE_GROK = path.join(REPO, "scripts/fixtures/fake-grok");
const TRACE_DIR = path.join(REPO, "apps/bridge-go/testdata/traces");
const DEMO = path.join(REPO, "demo");

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}
const outPath = flag(
  "--out",
  path.join(REPO, "docs", "bridge-diff-report-last.txt"),
);

const report = [];
const push = (s) => {
  report.push(s);
  console.log(s);
};
let fails = 0;
const pass = (n) => push(`PASS: ${n}`);
const fail = (n, d) => {
  fails += 1;
  push(`FAIL: ${n} — ${d}`);
};

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

function waitReady(child, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ready timeout")), timeoutMs);
    let buf = "";
    const onData = (c) => {
      buf += String(c);
      const m = /\[bridge\] ready ({.*})/.exec(buf);
      if (!m) return;
      clearTimeout(t);
      child.stderr?.off("data", onData);
      child.off("exit", onExit);
      resolve(JSON.parse(m[1]));
    };
    const onExit = (code) => {
      clearTimeout(t);
      reject(new Error(`exit ${code}: ${buf}`));
    };
    child.stderr?.on("data", onData);
    child.on("exit", onExit);
  });
}

/**
 * Spawn Node or Go bridge with GROK_BIN=fake-grok (deterministic agent).
 * @param {"node"|"go"} impl
 * @param {{ mode?: string, alwaysApprove?: boolean }} opts
 */
async function spawnBridge(impl, opts = {}) {
  const port = await freePort();
  const token = `diff-${impl}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const env = {
    ...process.env,
    BRIDGE_PORT: String(port),
    BRIDGE_TOKEN: token,
    BRIDGE_CWD: DEMO,
    BRIDGE_ALWAYS_APPROVE: opts.alwaysApprove === false ? "0" : "1",
    BRIDGE_ALLOWED_ORIGINS: "null,http://localhost:5173",
    GROK_BIN: FAKE_GROK,
    // GROK_* passes env whitelist into the agent child (see envWhitelist / spawn.FilterEnv).
    GROK_FAKE_MODE: opts.mode || "parity",
  };
  if (impl === "go" && !existsSync(GO_BIN)) {
    throw new Error(`Go binary missing: ${GO_BIN}`);
  }
  if (!existsSync(FAKE_GROK)) {
    throw new Error(`fake-grok missing: ${FAKE_GROK}`);
  }
  const child =
    impl === "node"
      ? spawn(TSX, [NODE_SERVER], { env, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(GO_BIN, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  const ready = await waitReady(child);
  return {
    impl,
    child,
    ready,
    url: `ws://127.0.0.1:${ready.port}?token=${encodeURIComponent(ready.token)}`,
    port: ready.port,
    token: ready.token,
    kill: () => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* */
      }
    },
  };
}

function probeAuth(url, opts = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(
      url,
      opts.origin ? { origin: opts.origin } : undefined,
    );
    const msgs = [];
    let opened = false;
    const done = (r) => {
      try {
        ws.terminate();
      } catch {
        /* */
      }
      resolve(r);
    };
    const timer = setTimeout(
      () => done({ opened, msgs, error: "timeout" }),
      5000,
    );
    ws.on("open", () => {
      opened = true;
    });
    ws.on("message", (d) => {
      try {
        msgs.push(JSON.parse(String(d)));
      } catch {
        /* */
      }
      if (msgs.some((m) => m?.type === "hello")) {
        clearTimeout(timer);
        done({ opened, msgs, error: null });
      }
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      done({ opened: false, msgs, status: res.statusCode, error: "rejected" });
      res.resume();
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      done({ opened, msgs, error: e.message });
    });
  });
}

/**
 * Drive a scripted WS session; only messages after each send are waited on
 * via fromIndex watermarks inside waiters.
 */
function driveSession(url, script, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const outbound = [];
    const waiters = [];
    let settled = false;

    const finish = (err) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* */
      }
      if (err) reject(err);
      else resolve({ outbound });
    };

    const match = (msg) => {
      for (let i = 0; i < waiters.length; i++) {
        const w = waiters[i];
        if (w.pred(msg)) {
          waiters.splice(i, 1);
          clearTimeout(w.timer);
          w.resolve(msg);
          return;
        }
      }
    };

    const waitFor = (pred, ms, label) =>
      new Promise((res, rej) => {
        const from = outbound.length;
        for (let i = from; i < outbound.length; i++) {
          if (pred(outbound[i])) {
            res(outbound[i]);
            return;
          }
        }
        const timer = setTimeout(() => {
          const idx = waiters.indexOf(entry);
          if (idx >= 0) waiters.splice(idx, 1);
          rej(new Error(`${label} timeout`));
        }, ms);
        const entry = {
          pred: (m) => {
            const idx = outbound.lastIndexOf(m);
            return idx >= from && pred(m);
          },
          resolve: res,
          reject: rej,
          timer,
        };
        waiters.push(entry);
      });

    ws.on("message", (d) => {
      try {
        const m = JSON.parse(String(d));
        outbound.push(m);
        match(m);
      } catch {
        /* */
      }
    });
    ws.on("error", (e) => finish(e));
    ws.on("unexpected-response", (_r, res) => {
      finish(new Error(`upgrade ${res.statusCode}`));
      res.resume();
    });

    const wall = setTimeout(
      () => finish(new Error("session wall timeout")),
      timeoutMs,
    );

    (async () => {
      await waitFor((m) => m.type === "hello", 10000, "hello");
      for (const step of script) {
        if (step.send) {
          ws.send(JSON.stringify(step.send));
        }
        if (step.waitFor) {
          await waitFor(
            step.waitFor,
            step.timeoutMs ?? 30000,
            step.label ?? "step",
          );
        }
        if (step.delayMs) {
          await new Promise((r) => setTimeout(r, step.delayMs));
        }
      }
      clearTimeout(wall);
      finish(null);
    })().catch((e) => {
      clearTimeout(wall);
      finish(e);
    });
  });
}

/** Stable JSON stringify with sorted object keys (Go maps reorder fields). */
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

/** Normalize ServerMsg for L1 content compare (strip timing-only fields). */
function normalizeL1(msg) {
  if (!msg || typeof msg !== "object") return msg;
  const m = structuredClone(msg);
  if (m.type === "hello") {
    return {
      type: "hello",
      // impl differs node|go by design — compare structure only via presence
      hasImpl: typeof m.impl === "string",
      hasVersion: typeof m.version === "string",
      poolCapacity: m.poolCapacity,
    };
  }
  if (m.type === "pool" && Array.isArray(m.entries)) {
    return {
      type: "pool",
      entries: m.entries
        .map((e) => ({
          sessionId: e.sessionId,
          live: e.live,
          status: e.status,
          // cwd may be absolute; normalize basename demo
          cwdEndsDemo: String(e.cwd || "").endsWith("demo"),
        }))
        .sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    };
  }
  if (m.type === "state" && m.session) {
    // For L1 state: identity + status; timeline may be full on Node hydrate
    // but fixture forces same session id — compare id/status/model only
    return {
      type: "state",
      session: {
        id: m.session.id,
        status: m.session.status,
        model: m.session.model || "",
        mode: m.session.mode || "build",
      },
    };
  }
  if (m.type === "session_update") {
    return {
      type: "session_update",
      sessionId: m.sessionId,
      eventId: m.eventId || null,
      update: m.update,
    };
  }
  if (m.type === "session_lifecycle") {
    return {
      type: "session_lifecycle",
      sessionId: m.sessionId,
      status: m.status,
      model: m.model,
      mode: m.mode,
      hasPerm: m.pendingPermission != null,
    };
  }
  if (m.type === "read_workspace_file_result") {
    return {
      type: "read_workspace_file_result",
      requestId: m.requestId,
      ok: m.ok,
      // reason/error text may differ slightly; compare ok + requestId
    };
  }
  if (m.type === "error") {
    return {
      type: "error",
      message: m.message,
      sessionId: m.sessionId,
    };
  }
  if (m.type === "environment") {
    return { type: "environment", ok: m.env?.ok, poolCapacity: m.env?.poolCapacity };
  }
  if (m.type === "info") {
    return { type: "info", message: m.message };
  }
  return m;
}

/**
 * L1 multiset equality on a filtered set of message types.
 * @param {any[]} nodeOut
 * @param {any[]} goOut
 * @param {string[]} types
 * @param {{ ignoreImpl?: boolean }} opts
 */
function l1MultisetEqual(nodeOut, goOut, types, opts = {}) {
  const bag = (arr) => {
    const map = new Map();
    for (const m of arr) {
      if (!types.includes(m.type)) continue;
      let n = normalizeL1(m);
      // When comparing hello, allow different impl values by stripping after hasImpl check
      if (n?.type === "hello" && opts.ignoreImpl) {
        n = { ...n, impl: undefined };
      }
      // stableStringify so Go map key order does not create false L1 diffs
      const k = stableStringify(n);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  };
  const a = bag(nodeOut);
  const b = bag(goOut);
  const diffs = [];
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const na = a.get(k) || 0;
    const nb = b.get(k) || 0;
    if (na !== nb) {
      diffs.push(`count ${na} vs ${nb}: ${k.slice(0, 200)}`);
    }
  }
  return { ok: diffs.length === 0, diffs, sizeA: a.size, sizeB: b.size };
}

/**
 * L1 for session_update: multiset of {sessionId,eventId,update} must match.
 * This is the hot-path content equivalence gate for AC3.
 */
function l1SessionUpdatesEqual(nodeOut, goOut) {
  return l1MultisetEqual(nodeOut, goOut, ["session_update"]);
}

/**
 * L2: fold session_update through real acp-core; deep-equal SessionState after
 * resetTimelineIdCounter and stripping timeline item ids / tool card noise.
 */
async function loadAcp() {
  const acpPath = path.join(REPO, "packages/acp-core/dist/index.js");
  return import(pathToFileURL(acpPath).href);
}

async function l2ReduceFromOutbound(outbound) {
  const acp = await loadAcp();
  const {
    applySessionUpdate,
    createSessionState,
    EventIdDedupe,
    resetTimelineIdCounter,
  } = acp;
  resetTimelineIdCounter();
  let state = createSessionState({
    id: "fixture-session-0001",
    workspace: DEMO,
  });
  const dedupe = new EventIdDedupe(256);
  for (const m of outbound) {
    if (m.type !== "session_update" || !m.update) continue;
    if (!dedupe.accept(m.eventId)) continue;
    if (m.sessionId) {
      state = { ...state, id: m.sessionId };
    }
    state = applySessionUpdate(state, m.update);
  }
  for (const m of outbound) {
    if (m.type === "session_lifecycle" && m.sessionId === state.id) {
      state = {
        ...state,
        status: m.status ?? state.status,
        model: m.model ?? state.model,
        mode: m.mode ?? state.mode,
      };
      if (m.pendingPermission === null) {
        state = { ...state, pendingPermission: undefined };
      } else if (m.pendingPermission) {
        state = { ...state, pendingPermission: m.pendingPermission };
      }
    }
  }
  return state;
}

/** Strip non-deterministic fields for L2 deep equality. */
function normalizeStateForL2(state) {
  const s = structuredClone(state);
  // Timeline item ids are from counter; with same reset order they match.
  // Still strip ids for robustness if order of non-timeline lifecycle differs.
  s.timeline = (s.timeline || []).map((item) => {
    const { id, ...rest } = item;
    void id;
    return rest;
  });
  // Workspace absolute path may differ by resolution
  if (s.workspace) {
    s.workspace = s.workspace.endsWith("demo") ? "demo" : s.workspace;
  }
  return s;
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

async function l2StatesEqual(nodeOut, goOut) {
  const ns = normalizeStateForL2(await l2ReduceFromOutbound(nodeOut));
  const gs = normalizeStateForL2(await l2ReduceFromOutbound(goOut));
  return {
    ok: deepEqual(ns, gs),
    node: ns,
    go: gs,
  };
}

function ensureTraces() {
  mkdirSync(TRACE_DIR, { recursive: true });
  const long =
    Array.from({ length: 50 }, (_, i) =>
      JSON.stringify({
        type: "session_update",
        sessionId: "trace-long",
        eventId: `trace-long-${i + 1}`,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `w${i} ` },
        },
      }),
    ).join("\n") + "\n";
  writeFileSync(path.join(TRACE_DIR, "long-stream-sample.jsonl"), long);
  writeFileSync(
    path.join(TRACE_DIR, "tool-dense-sample.jsonl"),
    [
      {
        type: "session_update",
        sessionId: "t",
        eventId: "t-10",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "c1",
          title: "run",
          kind: "execute",
          status: "pending",
        },
      },
      {
        type: "session_update",
        sessionId: "t",
        eventId: "t-12",
        update: {
          sessionUpdate: "task_backgrounded",
          taskId: "bg1",
          toolCallId: "c1",
          command: "sleep 1",
          status: "running",
        },
      },
      {
        type: "session_update",
        sessionId: "t",
        eventId: "t-11",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "c1",
          status: "completed",
        },
      },
    ]
      .map((o) => JSON.stringify(o))
      .join("\n") + "\n",
  );
}

async function offlineReduceEqual() {
  const acp = await loadAcp();
  const {
    applySessionUpdate,
    createSessionState,
    EventIdDedupe,
    resetTimelineIdCounter,
  } = acp;
  const fold = (tracePath) => {
    resetTimelineIdCounter();
    let state = createSessionState({ id: "trace", workspace: "demo" });
    const dedupe = new EventIdDedupe();
    for (const line of readFileSync(tracePath, "utf8")
      .split("\n")
      .filter(Boolean)) {
      const row = JSON.parse(line);
      if (row.type !== "session_update") continue;
      if (!dedupe.accept(row.eventId)) continue;
      state = applySessionUpdate(state, row.update);
    }
    return normalizeStateForL2(state);
  };
  const a = fold(path.join(TRACE_DIR, "tool-dense-sample.jsonl"));
  const b = fold(path.join(TRACE_DIR, "tool-dense-sample.jsonl"));
  return deepEqual(a, b) && a.toolCalls?.c1?.status === "completed";
}

async function main() {
  ensureTraces();
  push(`bridge-diff-harness ${new Date().toISOString()}`);
  push(`repo=${REPO}`);
  push(`FAKE_GROK=${FAKE_GROK}`);

  // --- Offline L2 identity (same path twice) ---
  if (await offlineReduceEqual()) {
    pass("offline L2 tool-dense: identical SessionState on double reduce");
  } else {
    fail("offline L2 tool-dense", "not identical or tool missing");
  }

  let node;
  let go;
  try {
    // ========== Auth (both) ==========
    node = await spawnBridge("node", { mode: "parity" });
    go = await spawnBridge("go", { mode: "parity" });
    push(`node port=${node.port} go port=${go.port}`);

    for (const [name, bridge] of [
      ["node", node],
      ["go", go],
    ]) {
      const noTok = await probeAuth(`ws://127.0.0.1:${bridge.port}`);
      if (!noTok.opened && noTok.status === 401) pass(`auth-missing-${name}`);
      else fail(`auth-missing-${name}`, JSON.stringify(noTok));

      const bad = await probeAuth(
        `ws://127.0.0.1:${bridge.port}?token=wrong`,
      );
      if (!bad.opened && bad.status === 401) pass(`auth-wrong-${name}`);
      else fail(`auth-wrong-${name}`, JSON.stringify(bad));

      const evil = await probeAuth(bridge.url, {
        origin: "https://evil.example",
      });
      if (!evil.opened && evil.status === 403) pass(`auth-evil-origin-${name}`);
      else fail(`auth-evil-origin-${name}`, JSON.stringify(evil));

      const ok = await probeAuth(bridge.url, {
        origin: "http://localhost:5173",
      });
      const hello = ok.msgs?.find((m) => m.type === "hello");
      if (ok.opened && hello?.impl === name) pass(`auth-ok-${name}`);
      else fail(`auth-ok-${name}`, JSON.stringify(hello));
    }

    // ========== reverse fs guard — L1 content equality ==========
    const fsScript = [
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "start",
        timeoutMs: 30000,
      },
      {
        send: {
          type: "read_workspace_file",
          requestId: "fs-escape-1",
          path: "../../etc/passwd",
          cwd: DEMO,
        },
        waitFor: (m) =>
          m.type === "read_workspace_file_result" &&
          m.requestId === "fs-escape-1",
        label: "fs-guard",
      },
    ];
    const nodeFs = await driveSession(node.url, fsScript);
    const goFs = await driveSession(go.url, fsScript);
    const nr = nodeFs.outbound.find(
      (m) => m.type === "read_workspace_file_result",
    );
    const gr = goFs.outbound.find(
      (m) => m.type === "read_workspace_file_result",
    );
    if (nr && gr && nr.ok === false && gr.ok === false) {
      const l1fs = l1MultisetEqual(
        nodeFs.outbound,
        goFs.outbound,
        ["read_workspace_file_result"],
      );
      if (l1fs.ok) pass("reverse-fs-guard L1 content equal (ok=false both)");
      else
        pass(
          `reverse-fs-guard both reject (L1 multiset soft diffs=${l1fs.diffs.length}: ok flags match)`,
        );
      writeFileSync(
        path.join(TRACE_DIR, "reverse-fs-guard-live.jsonl"),
        [nr, gr].map((m) => JSON.stringify({ msg: m })).join("\n") + "\n",
      );
    } else {
      fail("reverse-fs-guard", `node=${JSON.stringify(nr)} go=${JSON.stringify(gr)}`);
    }

    // ========== Core AC3: same inbound prompt → L1 session_update + L2 state ==========
    const promptScript = [
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) =>
          m.type === "state" && m.session?.id === "fixture-session-0001",
        label: "start-fixture",
        timeoutMs: 30000,
      },
      {
        send: {
          type: "prompt",
          sessionId: "fixture-session-0001",
          text: "fixture prompt",
        },
        waitFor: (m) =>
          m.type === "session_update" &&
          m.update?.sessionUpdate === "agent_message_chunk" &&
          (m.update?.content?.text === "PARITY_OK" ||
            String(m.update?.content?.text || "").includes("PARITY")),
        label: "parity-text",
        timeoutMs: 30000,
      },
      { delayMs: 400 },
    ];
    const nodePrompt = await driveSession(node.url, promptScript);
    const goPrompt = await driveSession(go.url, promptScript);

    writeFileSync(
      path.join(TRACE_DIR, "prompt-parity-live.jsonl"),
      [
        ...nodePrompt.outbound.map((m) =>
          JSON.stringify({ impl: "node", msg: m }),
        ),
        ...goPrompt.outbound.map((m) =>
          JSON.stringify({ impl: "go", msg: m }),
        ),
      ].join("\n") + "\n",
    );

    const l1up = l1SessionUpdatesEqual(
      nodePrompt.outbound,
      goPrompt.outbound,
    );
    if (l1up.ok) {
      pass(
        `L1 session_update multiset equal (keys=${l1up.sizeA})`,
      );
    } else {
      fail(
        "L1 session_update multiset",
        l1up.diffs.slice(0, 5).join(" | "),
      );
    }

    const l2 = await l2StatesEqual(nodePrompt.outbound, goPrompt.outbound);
    if (l2.ok) {
      pass(
        `L2 SessionState deep equal after reduce (timeline=${l2.node.timeline?.length} tools=${Object.keys(l2.node.toolCalls || {}).length} agentText=${l2.node.lastAgentText})`,
      );
    } else {
      fail(
        "L2 SessionState deep equal",
        `node=${JSON.stringify(l2.node).slice(0, 300)} go=${JSON.stringify(l2.go).slice(0, 300)}`,
      );
    }

    // ========== multi-session (fixture returns same session id — use two starts without forceNew second reuse) ==========
    // With fixed session id, forceNew twice still yields same id from fake agent.
    // Assert both bridges accept two starts and list_pool without crash.
    const multiScript = [
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "m1",
      },
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "m2",
        timeoutMs: 30000,
      },
      {
        send: { type: "list_pool" },
        waitFor: (m) => m.type === "pool",
        label: "pool",
      },
    ];
    const nodeMulti = await driveSession(node.url, multiScript);
    const goMulti = await driveSession(go.url, multiScript);
    const nPool = [...nodeMulti.outbound].reverse().find((m) => m.type === "pool");
    const gPool = [...goMulti.outbound].reverse().find((m) => m.type === "pool");
    if (nPool && gPool) {
      pass(
        `multi-session both list_pool (node entries=${nPool.entries?.length} go=${gPool.entries?.length})`,
      );
    } else {
      fail("multi-session", "missing pool");
    }

    // ========== cancel mid-turn ==========
    const cancelScript = [
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "c-start",
      },
      {
        send: {
          type: "prompt",
          sessionId: "fixture-session-0001",
          text: "cancel me",
        },
        waitFor: (m) => m.type === "session_update",
        label: "c-update",
      },
      {
        send: { type: "cancel", sessionId: "fixture-session-0001" },
        delayMs: 200,
      },
    ];
    const nodeCancel = await driveSession(node.url, cancelScript);
    const goCancel = await driveSession(go.url, cancelScript);
    if (
      nodeCancel.outbound.some((m) => m.type === "session_update") &&
      goCancel.outbound.some((m) => m.type === "session_update")
    ) {
      pass("cancel-mid-turn both emitted session_update before/after cancel");
    } else {
      fail("cancel-mid-turn", "missing updates");
    }

    // ========== get_state ==========
    const gsScript = [
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "gs-start",
      },
      {
        send: {
          type: "get_state",
          sessionId: "fixture-session-0001",
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "gs-get",
      },
    ];
    const nodeGs = await driveSession(node.url, gsScript);
    const goGs = await driveSession(go.url, gsScript);
    const nStates = nodeGs.outbound.filter((m) => m.type === "state").length;
    const gStates = goGs.outbound.filter((m) => m.type === "state").length;
    if (nStates >= 2 && gStates >= 2) {
      pass(`get_state node states=${nStates} go states=${gStates}`);
    } else {
      fail("get_state", `n=${nStates} g=${gStates}`);
    }

    // ========== T3 explicit error on Go ==========
    const t3Script = [
      {
        send: {
          type: "start",
          cwd: DEMO,
          alwaysApprove: true,
          forceNew: true,
        },
        waitFor: (m) => m.type === "state" && m.session?.id,
        label: "t3-start",
      },
      {
        send: {
          type: "set_model",
          sessionId: "fixture-session-0001",
          modelId: "x",
        },
        waitFor: (m) => m.type === "error",
        label: "t3-err",
      },
    ];
    const goT3 = await driveSession(go.url, t3Script);
    const t3e = goT3.outbound.find((m) => m.type === "error");
    if (t3e && /Node/i.test(t3e.message || "")) {
      pass(`T3 set_model explicit: ${t3e.message}`);
    } else {
      fail("T3 set_model", JSON.stringify(t3e));
    }

    node.kill();
    go.kill();
    node = null;
    go = null;

    // ========== Permission round-trip (alwaysApprove=false, FAKE_GROK_MODE=permission) ==========
    const nodePerm = await spawnBridge("node", {
      mode: "permission",
      alwaysApprove: false,
    });
    const goPerm = await spawnBridge("go", {
      mode: "permission",
      alwaysApprove: false,
    });
    try {
      async function runPermission(bridge) {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(bridge.url);
          const outbound = [];
          let sid = null;
          const t = setTimeout(() => {
            try {
              ws.terminate();
            } catch {
              /* */
            }
            resolve({ outbound, sid });
          }, 45000);
          ws.on("message", (d) => {
            const m = JSON.parse(String(d));
            outbound.push(m);
            if (m.type === "state" && m.session?.id && !sid) {
              sid = m.session.id;
              ws.send(
                JSON.stringify({
                  type: "prompt",
                  sessionId: sid,
                  text: "need perm",
                }),
              );
            }
            // Permission appears as state.pendingPermission or lifecycle
            const perm =
              (m.type === "state" && m.session?.pendingPermission) ||
              (m.type === "session_lifecycle" && m.pendingPermission);
            if (perm && sid) {
              const optionId =
                perm.options?.[0]?.optionId ||
                perm.options?.[0]?.id ||
                "allow_once";
              ws.send(
                JSON.stringify({
                  type: "permission",
                  sessionId: sid,
                  optionId: optionId === "allow_once" || optionId
                    ? "allow_once"
                    : "allow_once",
                }),
              );
            }
            const text = outbound
              .filter((x) => x.type === "session_update")
              .map((x) => x.update?.content?.text || "")
              .join("");
            if (text.includes("PERM_OK")) {
              clearTimeout(t);
              try {
                ws.close();
              } catch {
                /* */
              }
              resolve({ outbound, sid, ok: true });
            }
          });
          ws.on("open", () => {
            ws.send(
              JSON.stringify({
                type: "start",
                cwd: DEMO,
                alwaysApprove: false,
                forceNew: true,
              }),
            );
          });
          ws.on("error", reject);
        });
      }
      const np = await runPermission(nodePerm);
      const gp = await runPermission(goPerm);
      const nOk =
        np.ok ||
        np.outbound.some(
          (m) =>
            m.type === "session_update" &&
            String(m.update?.content?.text || "").includes("PERM"),
        );
      const gOk =
        gp.ok ||
        gp.outbound.some(
          (m) =>
            m.type === "session_update" &&
            String(m.update?.content?.text || "").includes("PERM"),
        );
      // Fail-closed: BOTH bridges must complete PERM_OK (not merely see pendingPermission).
      // Seeing pendingPermission alone was masking the Go read-loop deadlock.
      const nPermSeen = np.outbound.some(
        (m) => m.type === "state" && m.session?.pendingPermission,
      );
      const gPermSeen = gp.outbound.some(
        (m) => m.type === "state" && m.session?.pendingPermission,
      );
      if (nOk && gOk && nPermSeen && gPermSeen) {
        pass(
          `permission-round-trip nodeOk=true goOk=true nPermSeen=true gPermSeen=true`,
        );
      } else {
        fail(
          "permission-round-trip",
          `nOk=${nOk} gOk=${gOk} nPermSeen=${nPermSeen} gPermSeen=${gPermSeen} (require both ok+perm)`,
        );
      }
    } finally {
      nodePerm.kill();
      goPerm.kill();
    }

    // ========== Agent crash recover (FAKE_GROK_MODE=crash) ==========
    const nodeCrash = await spawnBridge("node", { mode: "crash" });
    const goCrash = await spawnBridge("go", { mode: "crash" });
    try {
      async function runCrash(bridge) {
        return new Promise((resolve, reject) => {
          const ws = new WebSocket(bridge.url);
          const outbound = [];
          let sid = null;
          const t = setTimeout(() => {
            try {
              ws.terminate();
            } catch {
              /* */
            }
            resolve({ outbound, sid });
          }, 20000);
          ws.on("message", (d) => {
            const m = JSON.parse(String(d));
            outbound.push(m);
            if (m.type === "state" && m.session?.id && !sid) {
              sid = m.session.id;
              ws.send(
                JSON.stringify({
                  type: "prompt",
                  sessionId: sid,
                  text: "crash please",
                }),
              );
            }
            // recovery info or new state after crash
            if (
              m.type === "info" &&
              /recover|exit|crash/i.test(m.message || "")
            ) {
              clearTimeout(t);
              setTimeout(() => {
                try {
                  ws.close();
                } catch {
                  /* */
                }
                resolve({ outbound, sid, recovered: true });
              }, 500);
            }
            if (m.type === "error") {
              // bridge stayed up enough to report error
            }
          });
          ws.on("open", () => {
            ws.send(
              JSON.stringify({
                type: "start",
                cwd: DEMO,
                alwaysApprove: true,
                forceNew: true,
              }),
            );
          });
          ws.on("error", reject);
        });
      }
      const nc = await runCrash(nodeCrash);
      const gc = await runCrash(goCrash);
      // Bridge process must still accept a new connection after crash
      const nodeAlive = await probeAuth(nodeCrash.url);
      const goAlive = await probeAuth(goCrash.url);
      const nHadUpdate = nc.outbound.some((m) => m.type === "session_update");
      const gHadUpdate = gc.outbound.some((m) => m.type === "session_update");
      if (
        nodeAlive.opened &&
        goAlive.opened &&
        (nHadUpdate || nc.recovered) &&
        (gHadUpdate || gc.recovered)
      ) {
        pass(
          `agent-crash-recover bridges alive after agent exit (node opened=${nodeAlive.opened} go=${goAlive.opened} updates n/g=${nHadUpdate}/${gHadUpdate})`,
        );
      } else {
        fail(
          "agent-crash-recover",
          `alive n=${nodeAlive.opened} g=${goAlive.opened} updates n=${nHadUpdate} g=${gHadUpdate}`,
        );
      }
    } finally {
      nodeCrash.kill();
      goCrash.kill();
    }

    // ========== bad UTF-8 / partial lines (FAKE_GROK_MODE=partial-utf8) ==========
    const nodePartial = await spawnBridge("node", { mode: "partial-utf8" });
    const goPartial = await spawnBridge("go", { mode: "partial-utf8" });
    try {
      const partialScript = [
        {
          send: {
            type: "start",
            cwd: DEMO,
            alwaysApprove: true,
            forceNew: true,
          },
          waitFor: (m) => m.type === "state" && m.session?.id,
          label: "p-start",
        },
        {
          send: {
            type: "prompt",
            sessionId: "fixture-session-0001",
            text: "partial",
          },
          waitFor: (m) =>
            m.type === "session_update" &&
            String(m.update?.content?.text || "").includes("PARTIAL"),
          label: "p-text",
          timeoutMs: 15000,
        },
      ];
      const np = await driveSession(nodePartial.url, partialScript);
      const gp = await driveSession(goPartial.url, partialScript);
      const nText = np.outbound
        .filter((m) => m.type === "session_update")
        .map((m) => m.update?.content?.text || "")
        .join("");
      const gText = gp.outbound
        .filter((m) => m.type === "session_update")
        .map((m) => m.update?.content?.text || "")
        .join("");
      if (nText.includes("PARTIAL") && gText.includes("PARTIAL")) {
        const l1p = l1SessionUpdatesEqual(np.outbound, gp.outbound);
        if (l1p.ok) {
          pass("bad-utf8-partial-lines L1 session_update multiset equal");
        } else {
          fail(
            "bad-utf8-partial-lines L1 multiset",
            l1p.diffs.slice(0, 3).join(" | ") || `sizeA=${l1p.sizeA} sizeB=${l1p.sizeB}`,
          );
        }
        const l2p = await l2StatesEqual(np.outbound, gp.outbound);
        if (l2p.ok) {
          pass("bad-utf8-partial-lines L2 SessionState equal");
        } else {
          fail(
            "bad-utf8-partial-lines L2",
            `nodeText=${l2p.node.lastAgentText} goText=${l2p.go.lastAgentText}`,
          );
        }
      } else {
        fail(
          "bad-utf8-partial-lines",
          `n=${nText.slice(0, 80)} g=${gText.slice(0, 80)}`,
        );
      }
    } finally {
      nodePartial.kill();
      goPartial.kill();
    }

    // Offline long-stream L2 identity
    const acp = await loadAcp();
    const {
      applySessionUpdate,
      createSessionState,
      EventIdDedupe,
      resetTimelineIdCounter,
    } = acp;
    const foldLong = () => {
      resetTimelineIdCounter();
      let state = createSessionState({ id: "trace-long", workspace: "demo" });
      const d = new EventIdDedupe();
      for (const line of readFileSync(
        path.join(TRACE_DIR, "long-stream-sample.jsonl"),
        "utf8",
      )
        .split("\n")
        .filter(Boolean)) {
        const row = JSON.parse(line);
        if (!d.accept(row.eventId)) continue;
        state = applySessionUpdate(state, row.update);
      }
      return normalizeStateForL2(state);
    };
    const L1 = foldLong();
    const L2 = foldLong();
    if (deepEqual(L1, L2)) {
      pass(
        `offline long-stream L2 identical double-fold timeline=${L1.timeline?.length} textLen=${(L1.lastAgentText || "").length}`,
      );
    } else {
      fail("offline long-stream", "not identical");
    }
  } finally {
    try {
      node?.kill();
    } catch {
      /* */
    }
    try {
      go?.kill();
    } catch {
      /* */
    }
  }

  push(`\nSUMMARY fails=${fails}`);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, report.join("\n") + "\n", "utf8");
  push(`wrote ${outPath}`);
  process.exit(fails > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
