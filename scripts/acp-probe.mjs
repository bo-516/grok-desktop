// Purpose: map the real ACP surface of `grok agent stdio`, write docs/probe-report.json
// Usage: node scripts/acp-probe.mjs [cwd]
// Requires: ENV-CLI. Without auth the script throws at authenticate and prints authMethods.
import { spawn } from "node:child_process";
import readline from "node:readline";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const cwd = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(REPO_ROOT, "demo");

function resolveGrokBin() {
  const candidates = [
    process.env.GROK_BIN,
    path.join(process.env.HOME ?? "", ".grok/bin/grok"),
    "grok",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === "grok") return c;
    if (existsSync(c)) return c;
  }
  throw new Error("grok binary not found (set GROK_BIN or install CLI)");
}

const bin = resolveGrokBin();
// Global --no-auto-update before `agent` (agent subcommand rejects the flag on some CLIs).
const proc = spawn(bin, ["--no-auto-update", "agent", "stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd,
  env: { ...process.env },
});
const rl = readline.createInterface({ input: proc.stdout });
const pending = new Map();
const updates = [];
const reverse = [];
const commandSnapshots = [];
let nextId = 1;

proc.stderr.on("data", (c) => process.stderr.write(c));

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === "session/update") {
    const kind = msg.params?.update?.sessionUpdate;
    updates.push(kind);
    if (kind === "available_commands_update") {
      commandSnapshots.push(msg.params?.update?.availableCommands ?? []);
    }
    return;
  }
  if (msg.method && msg.id !== undefined) {
    reverse.push({ method: msg.method, params: msg.params });
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "probe" },
      }) + "\n",
    );
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(msg.error) : p.resolve(msg.result ?? {});
});

const req = (method, params, ms = 30000) =>
  new Promise((res, rej) => {
    const id = nextId++;
    const t = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`${method} timeout`));
    }, ms);
    pending.set(id, {
      resolve: (v) => (clearTimeout(t), res(v)),
      reject: (e) => (clearTimeout(t), rej(e)),
    });
    proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });

const probe = async (method, params) => {
  try {
    return { ok: true, result: await req(method, params, 8000) };
  } catch (e) {
    const err = e && typeof e === "object" ? e : { message: String(e) };
    return {
      ok: false,
      error: String(err.message ?? e),
      code: err.code,
      data: err.data,
    };
  }
};

const report = {
  probeAt: new Date().toISOString(),
  cwd,
  grokBin: bin,
};
try {
  report.initialize = await req("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
  });
  const methods = new Set(
    (report.initialize.authMethods ?? []).map((m) => m.id),
  );
  const methodId =
    process.env.XAI_API_KEY && methods.has("xai.api_key")
      ? "xai.api_key"
      : methods.has("cached_token")
        ? "cached_token"
        : null;
  if (!methodId) throw new Error(`no usable authMethod: ${[...methods]}`);
  await req("authenticate", { methodId, _meta: { headless: true } });

  const s = await req("session/new", { cwd, mcpServers: [] });
  report.sessionNew = s;
  const sessionId = s.sessionId;

  report.setModel = await probe("session/set_model", {
    sessionId,
    modelId: "grok-build",
  });
  report.setModelAlt = await probe("session/set_model", {
    sessionId,
    model: "grok-build",
  });
  report.setMode = await probe("session/set_mode", {
    sessionId,
    modeId: "plan",
  });
  report.setModeAlt = await probe("session/set_mode", {
    sessionId,
    mode: "plan",
  });
  report.compact = await probe("session/compact", { sessionId });
  report.tokens = await probe("session/token_usage", { sessionId });
  report.tokenUsageAlt = await probe("session/tokens", { sessionId });

  // PROBE-03: short prompt to collect update kinds + commands
  await req(
    "session/prompt",
    {
      sessionId,
      prompt: [{ type: "text", text: "Say hi in one sentence." }],
    },
    90000,
  );
  await new Promise((r) => setTimeout(r, 2000));

  // PROBE-04: slash commands as prompt text
  report.slashContext = await probe("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "/context" }],
  });
  await new Promise((r) => setTimeout(r, 1500));

  // PROBE-07: image content block
  const tinyPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  report.imagePrompt = await probe("session/prompt", {
    sessionId,
    prompt: [
      { type: "text", text: "Describe this image briefly." },
      { type: "image", mimeType: "image/png", data: tinyPng },
    ],
  });

  report.updateKinds = [...new Set(updates.filter(Boolean))];
  report.reverseMethods = [...new Set(reverse.map((r) => r.method))];
  report.reverseSamples = reverse.slice(0, 8);
  report.availableCommands = commandSnapshots.at(-1) ?? [];
  report.commandCount = report.availableCommands.length;

  // Classification helper for §24
  const classify = (probeResult) => {
    if (!probeResult) return "unknown";
    if (probeResult.ok) return "ACP";
    const msg = String(probeResult.error ?? "");
    if (msg.includes("-32601") || msg.toLowerCase().includes("method not")) {
      return "SPAWN_OR_CMD";
    }
    return "ACP_PARAM_OR_OTHER";
  };
  report.classification = {
    set_model: classify(report.setModel),
    set_model_alt: classify(report.setModelAlt),
    set_mode: classify(report.setMode),
    set_mode_alt: classify(report.setModeAlt),
    compact: classify(report.compact),
    tokens: classify(report.tokens),
    image: classify(report.imagePrompt),
    reverseHasTerminal: report.reverseMethods.some((m) =>
      String(m).startsWith("terminal"),
    ),
  };
} catch (e) {
  report.fatal = String(e.message ?? e);
} finally {
  const outPath = path.join(REPO_ROOT, "docs/probe-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  rl.close();
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
}
