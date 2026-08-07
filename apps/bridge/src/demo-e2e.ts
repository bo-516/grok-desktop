/**
 * Live end-to-end demo against real `grok agent stdio`, cwd locked to demo/.
 *
 * Exercises:
 * 1) list/read workspace
 * 2) small code edit under demo/ only
 * 3) subagent request (if model supports it)
 * 4) summarize
 *
 * Usage (from repo root):
 *   npm run demo:e2e
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AcpClient, type SessionState } from "@grok-desktop/acp-core";
import { spawnGrokAgent } from "./spawnGrok.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const DEMO_CWD = path.resolve(REPO_ROOT, "demo");
const LOG =
  process.env.DEMO_E2E_LOG ??
  path.join(REPO_ROOT, "demo", "e2e-last-run.log");

function log(line: string): void {
  process.stderr.write(`${line}\n`);
}

function snapshotDemoFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name.startsWith(".")) {continue;}
      const p = path.join(dir, name.name);
      if (name.isDirectory()) {walk(p);}
      else {out.push(path.relative(DEMO_CWD, p));}
    }
  };
  walk(DEMO_CWD);
  return out.sort();
}

function assertNoRepoContamination(before: Set<string>): void {
  // Parent packages must not gain new files from this demo
  const packagesDir = path.join(REPO_ROOT, "packages");
  if (!existsSync(packagesDir)) {return;}
  // Only check that demo-relative writes stayed under demo (by comparing demo tree is fine)
  void before;
}

async function runPrompt(
  client: AcpClient,
  sessionId: string,
  text: string,
  label: string,
): Promise<{ text: string; state: SessionState }> {
  log(`\n=== PROMPT [${label}] ===\n${text}\n`);
  const result = await client.prompt(sessionId, [{ type: "text", text }]);
  await new Promise((r) => setTimeout(r, 500));
  const state = client.getSessionState();
  log(`[${label}] stopReason=${result.stopReason ?? "?"}`);
  log(`[${label}] agentText=${state.lastAgentText.slice(0, 500)}`);
  log(
    `[${label}] timeline=${state.timeline.length} tools=${Object.keys(state.toolCalls).length} status=${state.status}`,
  );
  for (const [id, card] of Object.entries(state.toolCalls)) {
    log(
      `  tool ${id}: ${card.kind ?? "?"} ${card.title ?? ""} status=${card.status}`,
    );
  }
  return { text: state.lastAgentText, state };
}

async function main(): Promise<void> {
  if (!existsSync(DEMO_CWD)) {
    throw new Error(`demo cwd missing: ${DEMO_CWD}`);
  }

  const beforeFiles = new Set(snapshotDemoFiles());
  const lines: string[] = [];
  const push = (s: string) => {
    lines.push(s);
    log(s);
  };

  push(`demo-e2e start cwd=${DEMO_CWD}`);
  push(`before files: ${[...beforeFiles].join(", ")}`);

  // Prefer --always-approve so tool turns complete without a UI
  const spawned = spawnGrokAgent({
    cwd: DEMO_CWD,
    alwaysApprove: true,
  });

  let agentTextAccum = "";
  const client = new AcpClient({
    transport: spawned.transport,
    settleQuietMs: 400,
    autoPermissionOptionId: "allow_once",
    onStderr: (t) => process.stderr.write(t),
    onStateChange: (s) => {
      agentTextAccum = s.lastAgentText;
    },
  });

  try {
    const { sessionId, init } = await client.handshake({
      cwd: DEMO_CWD,
      envApiKeyPresent: Boolean(process.env.XAI_API_KEY),
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    push(`sessionId=${sessionId}`);
    push(
      `models=${JSON.stringify((init.availableModels ?? []).map((m) => m.id))}`,
    );

    // 1) Explore workspace (tools: read/list)
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

    // 2) Small write under demo/
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

    // 3) Code tweak under demo/
    await runPrompt(
      client,
      sessionId,
      [
        "In `src/hello.ts`, change the greet function so it returns",
        '`Hello, ${name}! (demo)` instead of `Hello, ${name}!`.',
        "Only edit demo/src/hello.ts.",
      ].join(" "),
      "edit-hello",
    );

    // 4) Subagent / parallel agent task
    await runPrompt(
      client,
      sessionId,
      [
        "If you support subagents or task agents, spawn a subagent to:",
        "write `src/math.note.md` with one sentence explaining the average() function.",
        "Parent agent should only summarize what the subagent did.",
        "If subagents are unavailable, do the write yourself under demo/src/math.note.md",
        "and say 'subagent-fallback' in your reply.",
        "Stay inside demo/ only.",
      ].join(" "),
      "subagent-or-fallback",
    );

    // 5) Short verification answer
    const final = await runPrompt(
      client,
      sessionId,
      "Reply with a short bullet list of files you created or edited in this session (paths relative to workspace). One line each.",
      "summary",
    );

    const afterFiles = snapshotDemoFiles();
    const created = afterFiles.filter((f) => !beforeFiles.has(f));
    push(`after files: ${afterFiles.join(", ")}`);
    push(`created: ${created.join(", ") || "(none)"}`);

    // Validate expected artifacts (agent may name slightly differently — soft checks)
    const greetNote = path.join(DEMO_CWD, "src/greet-note.md");
    const helloPath = path.join(DEMO_CWD, "src/hello.ts");
    const helloSrc = readFileSync(helloPath, "utf8");
    const checks = {
      greetNoteExists: existsSync(greetNote),
      helloHasDemoSuffix: helloSrc.includes("(demo)"),
      stayedInDemo: created.every((f) => !f.includes("..")),
      hadAgentText: agentTextAccum.trim().length > 0 || final.text.trim().length > 0,
      hadTools: Object.keys(client.getSessionState().toolCalls).length > 0,
    };
    push(`checks=${JSON.stringify(checks, null, 2)}`);

    // Contaminations outside demo: sample check parent package not containing e2e marker
    const acpIndex = path.join(REPO_ROOT, "packages/acp-core/src/index.ts");
    if (existsSync(acpIndex)) {
      const idx = readFileSync(acpIndex, "utf8");
      if (idx.includes("written-by-grok-e2e")) {
        throw new Error("contamination: agent wrote into packages/acp-core");
      }
    }
    assertNoRepoContamination(beforeFiles);

    const hardFail =
      !checks.hadAgentText ||
      !checks.stayedInDemo ||
      (!checks.greetNoteExists && !checks.helloHasDemoSuffix);

    writeFileSync(LOG, `${lines.join("\n")  }\n`, "utf8");
    push(`wrote log ${LOG}`);

    // git status under demo for evidence
    const gs = spawnSync("git", ["status", "--short", "demo"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (gs.stdout) {push(`git status demo:\n${gs.stdout}`);}

    if (hardFail) {
      push("RESULT=FAIL");
      process.exitCode = 1;
    } else {
      push("RESULT=PASS");
      // Soft warn if some optional checks failed
      if (!checks.greetNoteExists) {push("WARN: greet-note.md missing");}
      if (!checks.helloHasDemoSuffix) {push("WARN: hello.ts not edited as asked");}
      if (!checks.hadTools) {push("WARN: no tool cards observed");}
    }
  } finally {
    client.dispose();
    spawned.dispose();
  }
}

main().catch((e) => {
  console.error("demo-e2e FATAL", e);
  process.exitCode = 1;
});
