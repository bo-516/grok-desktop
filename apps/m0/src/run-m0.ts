/**
 * M0 entry: ACP handshake + prompt against live `grok agent stdio` or in-process mock.
 *
 * Usage:
 *   npm run m0           # try live, fall back to mock
 *   npm run m0:live      # live only (fail if CLI missing)
 *   npm run m0:mock      # mock only
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import {
  AcpClient,
  createMockAcpPair,
  createStdoutLineSplitter,
  type AcpTransport,
} from "@grok-desktop/acp-core";

const args = new Set(process.argv.slice(2));
const forceMock = args.has("--mock");
const forceLive = args.has("--live");
const promptText =
  process.env.M0_PROMPT ??
  "Reply with exactly one short sentence describing what an ACP client is.";

const cwd = process.env.M0_CWD ?? process.cwd();
const logPath = process.env.M0_LOG;

function resolveGrokBin(): string | null {
  const candidates = [
    process.env.GROK_BIN,
    "grok",
    path.join(process.env.HOME ?? "", ".grok/bin/grok"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (c === "grok") {return c;} // rely on PATH
    if (existsSync(c)) {return c;}
  }
  return null;
}

function createChildTransport(
  child: ChildProcessWithoutNullStreams,
): AcpTransport {
  const lineHandlers: Array<(line: string) => void> = [];
  const closeHandlers: Array<(code: number | null) => void> = [];
  const errHandlers: Array<(chunk: string) => void> = [];

  const onData = createStdoutLineSplitter((line) => {
    for (const h of lineHandlers) {h(line);}
  });
  child.stdout.on("data", onData);
  child.stderr.on("data", (d: Buffer) => {
    const s = d.toString("utf8");
    for (const h of errHandlers) {h(s);}
  });
  child.on("close", (code) => {
    for (const h of closeHandlers) {h(code);}
  });

  return {
    write: (data) => {
      child.stdin.write(data);
    },
    onLine: (h) => {
      lineHandlers.push(h);
    },
    onClose: (h) => {
      closeHandlers.push(h);
    },
    onStderr: (h) => {
      errHandlers.push(h);
    },
    dispose: () => {
      if (!child.killed) {child.kill("SIGTERM");}
    },
  };
}

async function runWithTransport(
  label: string,
  transport: AcpTransport,
  extra?: { whenIdle?: () => Promise<void> },
): Promise<{ agentText: string; stopReason?: string; sessionId: string }> {
  const stderrChunks: string[] = [];
  const client = new AcpClient({
    transport,
    settleQuietMs: 250,
    // Live runs: auto-allow so M0 does not hang on permission without a UI.
    autoPermissionOptionId: "allow_once",
    onStderr: (c) => {
      stderrChunks.push(c);
      process.stderr.write(c);
    },
  });

  console.error(`[m0] mode=${label} cwd=${cwd}`);
  const { init, sessionId } = await client.handshake({
    cwd,
    envApiKeyPresent: Boolean(process.env.XAI_API_KEY),
  });
  console.error(
    `[m0] models=${JSON.stringify((init.availableModels ?? []).map((m) => m.id))}`,
  );
  console.error(`[m0] sessionId=${sessionId}`);

  const result = await client.prompt(sessionId, [
    { type: "text", text: promptText },
  ]);
  if (extra?.whenIdle) {await extra.whenIdle();}
  // Drain quiet window for late chunks
  await new Promise((r) => setTimeout(r, 400));

  const state = client.getSessionState();
  const agentText = state.lastAgentText.trim();
  console.log(agentText);
  console.log("stopReason:", result.stopReason ?? "(none)");
  console.error(
    `[m0] timeline items=${state.timeline.length} tools=${Object.keys(state.toolCalls).length}`,
  );

  client.dispose();
  return {
    agentText,
    stopReason: result.stopReason,
    sessionId,
  };
}

async function runLive(): Promise<{
  agentText: string;
  stopReason?: string;
  sessionId: string;
}> {
  const bin = resolveGrokBin();
  if (!bin) {
    throw new Error("grok binary not found");
  }
  // Note: older todo.md used `--no-auto-update`; current grok CLI rejects unknown flags.
  const child = spawn(bin, ["agent", "stdio"], {
    stdio: "pipe",
    cwd,
    env: { ...process.env },
  }) as ChildProcessWithoutNullStreams;

  const transport = createChildTransport(child);
  try {
    return await runWithTransport("live", transport);
  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

async function runMock(): Promise<{
  agentText: string;
  stopReason?: string;
  sessionId: string;
}> {
  const pair = createMockAcpPair({ emitPermission: true, chunkDelayMs: 5 });
  try {
    return await runWithTransport("mock", pair.clientTransport, {
      whenIdle: pair.whenIdle,
    });
  } finally {
    pair.dispose();
  }
}

function writeLog(file: string, body: string): void {
  const stream = createWriteStream(file, { flags: "w" });
  stream.write(body);
  stream.end();
}

async function main(): Promise<void> {
  let mode = "auto";
  let result: { agentText: string; stopReason?: string; sessionId: string };
  const fallbackNote = "";

  try {
    // Product policy: real grok-build only. Mock is opt-in via --mock for unit/dev isolation.
    if (forceMock) {
      console.error(
        "[m0] WARN: --mock is for isolated protocol tests only; product path must use live grok",
      );
      mode = "mock";
      result = await runMock();
    } else {
      mode = "live";
      result = await runLive();
    }
    void forceLive;
  } catch (e) {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    console.error("[m0] FATAL", msg);
    if (logPath) {
      writeLog(
        logPath,
        `FAIL mode=${mode}\n${msg}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }

  if (!result.agentText) {
    console.error("[m0] FAIL: empty agent text");
    process.exitCode = 1;
  } else {
    console.error(`[m0] OK mode=${mode} chars=${result.agentText.length}`);
  }

  if (logPath) {
    writeLog(
      logPath,
      [
        `mode=${mode}`,
        `sessionId=${result.sessionId}`,
        `stopReason=${result.stopReason ?? ""}`,
        `fallback=${fallbackNote}`,
        "--- agent text ---",
        result.agentText,
        "",
      ].join("\n"),
    );
    console.error(`[m0] wrote log ${logPath}`);
  }
}

main();
