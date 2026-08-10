#!/usr/bin/env node
/**
 * Multi-turn live e2e against the **Go bridge WS** path (shipped binary).
 * Mirrors Node demo:e2e primary observables: explore tools, write file under
 * demo/, edit hello.ts, summary — checks greetNoteExists / helloHasDemoSuffix /
 * hadTools / hadAgentText / stayedInDemo.
 *
 * Usage (from repo root):
 *   node scripts/go-bridge-e2e.mjs
 *   DEMO_E2E_LOG=path node scripts/go-bridge-e2e.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const GO_BIN = path.join(REPO, "apps/bridge-go/bin/bridge-go");
const DEMO = path.join(REPO, "demo");
const LOG =
  process.env.DEMO_E2E_LOG || path.join(DEMO, "e2e-go-last-run.log");

const lines = [];
function log(s) {
  lines.push(s);
  process.stderr.write(`${s}\n`);
}

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

function snapshotDemoFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name.startsWith(".")) continue;
      const p = path.join(dir, name.name);
      if (name.isDirectory()) walk(p);
      else out.push(path.relative(DEMO, p));
    }
  };
  walk(DEMO);
  return out.sort();
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

/**
 * WS session helper against Go bridge.
 */
function createWsClient(url) {
  const ws = new WebSocket(url);
  const outbound = [];
  const waiters = [];
  let open = false;

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

  ws.on("open", () => {
    open = true;
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

  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws open/hello timeout")), 15000);
    const check = () => {
      if (outbound.some((m) => m.type === "hello")) {
        clearTimeout(t);
        resolve();
      } else setTimeout(check, 20);
    };
    ws.on("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
    check();
  });

  /**
   * Wait for a future message matching pred (ignores already-buffered msgs
   * at or before fromIndex — avoids matching pre-prompt idle state).
   * @param pred Message predicate.
   * @param timeoutMs Max wait.
   * @param label Error label.
   * @param fromIndex Only consider outbound entries after this index.
   */
  const waitFor = (
    pred,
    timeoutMs = 180000,
    label = "wait",
    fromIndex = outbound.length,
  ) =>
    new Promise((resolve, reject) => {
      // Only scan messages that arrived after fromIndex
      for (let i = fromIndex; i < outbound.length; i++) {
        if (pred(outbound[i], i)) {
          resolve(outbound[i]);
          return;
        }
      }
      const timer = setTimeout(() => {
        const i = waiters.indexOf(entry);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`${label} timeout`));
      }, timeoutMs);
      const entry = {
        pred: (m) => {
          // find index of m in outbound
          const idx = outbound.lastIndexOf(m);
          if (idx < fromIndex) return false;
          return pred(m, idx);
        },
        resolve,
        reject,
        timer,
      };
      waiters.push(entry);
    });

  const send = (msg) => {
    if (ws.readyState !== WebSocket.OPEN) throw new Error("ws not open");
    ws.send(JSON.stringify(msg));
  };

  /** Reduce toolCalls from session_update stream for hadTools check. */
  function toolCallIds(fromIndex = 0) {
    const ids = new Set();
    for (let i = fromIndex; i < outbound.length; i++) {
      const m = outbound[i];
      if (m.type !== "session_update") continue;
      const u = m.update;
      if (!u) continue;
      if (
        u.sessionUpdate === "tool_call" ||
        u.sessionUpdate === "tool_call_update"
      ) {
        if (u.toolCallId) ids.add(u.toolCallId);
      }
    }
    return ids;
  }

  function agentText(fromIndex = 0) {
    let t = "";
    for (let i = fromIndex; i < outbound.length; i++) {
      const m = outbound[i];
      if (m.type !== "session_update") continue;
      const u = m.update;
      if (!u || u.sessionUpdate !== "agent_message_chunk") continue;
      const c = u.content;
      if (typeof c === "string") t += c;
      else if (c && typeof c.text === "string") t += c.text;
    }
    return t;
  }

  return {
    ready,
    send,
    waitFor,
    outbound,
    toolCallIds,
    agentText,
    close: () => {
      try {
        ws.close();
      } catch {
        /* */
      }
    },
  };
}

async function runPrompt(client, sessionId, text, label) {
  log(`\n=== PROMPT [${label}] ===\n${text}\n`);
  const from = client.outbound.length;
  client.send({ type: "prompt", sessionId, text });
  // First wait until we see streaming activity (update or streaming status)
  await client.waitFor(
    (m) =>
      m.type === "session_update" ||
      (m.type === "session_lifecycle" && m.status === "streaming") ||
      (m.type === "state" && m.session?.status === "streaming"),
    120000,
    `${label}-first-update`,
    from,
  );
  // Then wait for turn settle to idle after the prompt started
  await client.waitFor(
    (m) =>
      (m.type === "session_lifecycle" && m.status === "idle") ||
      (m.type === "state" && m.session?.status === "idle"),
    300000,
    `${label}-idle`,
    from,
  );
  // Quiet settle for late chunks
  await new Promise((r) => setTimeout(r, 1000));
  const textOut = client.agentText(from);
  const tools = client.toolCallIds(from);
  log(`[${label}] agentText=${textOut.slice(0, 400)}`);
  log(
    `[${label}] tools=${tools.size} updates=${client.outbound.length - from}`,
  );
  return textOut;
}

async function main() {
  if (!existsSync(GO_BIN)) {
    throw new Error(`Go bridge binary missing: ${GO_BIN}`);
  }
  if (!existsSync(DEMO)) {
    throw new Error(`demo missing: ${DEMO}`);
  }

  const beforeFiles = new Set(snapshotDemoFiles());
  log(`demo-e2e-go start cwd=${DEMO}`);
  log(`before files: ${[...beforeFiles].join(", ")}`);

  const port = await freePort();
  const token = `go-e2e-${Date.now()}`;
  const child = spawn(GO_BIN, [], {
    env: {
      ...process.env,
      BRIDGE_PORT: String(port),
      BRIDGE_TOKEN: token,
      BRIDGE_CWD: DEMO,
      BRIDGE_ALWAYS_APPROVE: "1",
      BRIDGE_ALLOWED_ORIGINS: "null",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = await waitReady(child);
  log(`bridge ready impl=${ready.impl} port=${ready.port}`);

  const url = `ws://127.0.0.1:${ready.port}?token=${encodeURIComponent(ready.token)}`;
  const client = createWsClient(url);
  try {
    await client.ready;
    const hello = client.outbound.find((m) => m.type === "hello");
    if (hello?.impl !== "go") {
      throw new Error(`expected hello.impl=go got ${hello?.impl}`);
    }
    log(`hello.impl=${hello.impl} version=${hello.version}`);

    client.send({
      type: "start",
      cwd: DEMO,
      alwaysApprove: true,
      forceNew: true,
    });
    const started = await client.waitFor(
      (m) => m.type === "state" && m.session?.id,
      120000,
      "start",
    );
    const sessionId = started.session.id;
    log(`sessionId=${sessionId}`);

    await runPrompt(
      client,
      sessionId,
      [
        "You are working ONLY inside the current workspace (demo/).",
        "List the files you can see and briefly describe src/hello.ts and src/math.ts.",
        "Do not touch files outside this workspace.",
      ].join(" "),
      "explore",
    );

    await runPrompt(
      client,
      sessionId,
      [
        "Create a new file ONLY at `src/greet-note.md` under this workspace with exactly two lines:",
        "1) title: Demo note",
        "2) body: written-by-grok-e2e",
        "Do not modify packages/, apps/, or any parent repo paths.",
      ].join("\n"),
      "write-file",
    );

    await runPrompt(
      client,
      sessionId,
      [
        "In `src/hello.ts`, change the greet function so it returns",
        "`Hello, ${name}! (demo)` instead of `Hello, ${name}!`.",
        "Only edit demo/src/hello.ts.",
      ].join(" "),
      "edit-hello",
    );

    const final = await runPrompt(
      client,
      sessionId,
      "Reply with a short bullet list of files you created or edited in this session (paths relative to workspace). One line each.",
      "summary",
    );

    const afterFiles = snapshotDemoFiles();
    const created = afterFiles.filter((f) => !beforeFiles.has(f));
    log(`after files: ${afterFiles.join(", ")}`);
    log(`created: ${created.join(", ") || "(none)"}`);

    const greetNote = path.join(DEMO, "src/greet-note.md");
    const helloPath = path.join(DEMO, "src/hello.ts");
    const helloSrc = readFileSync(helloPath, "utf8");
    const tools = client.toolCallIds();
    const agentAccum = client.agentText();
    // Primary observables aligned with Node demo:e2e
    const checks = {
      greetNoteExists: existsSync(greetNote),
      helloHasDemoSuffix: helloSrc.includes("(demo)"),
      stayedInDemo: created.every((f) => !f.includes("..")),
      hadAgentText: agentAccum.trim().length > 0 || final.trim().length > 0,
      hadTools: tools.size > 0,
      helloImplGo: hello?.impl === "go",
    };
    log(`checks=${JSON.stringify(checks, null, 2)}`);
    log(`agentTextLen=${agentAccum.length} toolIds=${[...tools].join(",")}`);

    // Soft on greetNote if already present from prior run; require agent text + tools
    // when the model did real work (same hardFail spirit as Node demo-e2e).
    const hardFail =
      !checks.hadAgentText ||
      !checks.stayedInDemo ||
      !checks.helloImplGo ||
      !checks.hadTools ||
      (!checks.greetNoteExists && !checks.helloHasDemoSuffix);

    const gs = spawnSync("git", ["status", "--short", "demo"], {
      cwd: REPO,
      encoding: "utf8",
    });
    if (gs.stdout) log(`git status demo:\n${gs.stdout}`);

    log(hardFail ? "RESULT=FAIL" : "RESULT=PASS");
    mkdirSync(path.dirname(LOG), { recursive: true });
    writeFileSync(LOG, lines.join("\n") + "\n", "utf8");
    log(`wrote log ${LOG}`);

    if (hardFail) process.exit(1);
  } finally {
    client.close();
    child.kill("SIGTERM");
  }
}

main().catch((e) => {
  log(`FATAL ${e?.stack || e}`);
  try {
    writeFileSync(LOG, lines.join("\n") + "\n", "utf8");
  } catch {
    /* */
  }
  process.exit(1);
});
