/**
 * Spawn `grok agent stdio` and wrap as AcpTransport.
 * Workspace cwd should be the demo folder for constrained runs.
 *
 * On dispose, terminates the whole process group so stdio MCP children
 * (e.g. browser-use / uvx Python) do not leak after the agent exits.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createStdoutLineSplitter,
  type AcpTransport,
} from "@grok-desktop/acp-core";
import { filterEnvForGrokChild } from "./envWhitelist.js";

/** Grace period before escalating SIGTERM → SIGKILL for the agent tree. */
const DISPOSE_KILL_GRACE_MS = 2_000;

export function resolveGrokBin(): string {
  const candidates = [
    process.env.GROK_BIN,
    path.join(process.env.HOME ?? "", ".grok/bin/grok"),
    "grok",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (c === "grok") {return c;}
    if (existsSync(c)) {return c;}
  }
  throw new Error("grok binary not found (set GROK_BIN or install CLI)");
}

export type SpawnGrokOptions = {
  cwd: string;
  /** Pass --always-approve to skip interactive tool prompts in the CLI. */
  alwaysApprove?: boolean;
  /** Extra args inserted on `grok agent` before `stdio` (SPAWN flags). */
  extraArgs?: string[];
  /** Env overrides merged into child env (e.g. GROK_WEB_FETCH=1). */
  env?: NodeJS.ProcessEnv;
};

/**
 * Whether this platform can put the child in its own process group
 * (Unix detached + kill(-pid)). Windows falls back to direct kill.
 */
function supportsProcessGroup(): boolean {
  return process.platform !== "win32";
}

/**
 * Signal the agent process (and its group when available).
 * @param pid Agent root pid; when useGroup, negative kill targets the whole tree.
 * @param signal SIGTERM first, then SIGKILL after grace.
 * @param useGroup True when the child was spawned detached as group leader.
 */
function signalAgentTree(
  pid: number,
  signal: NodeJS.Signals,
  useGroup: boolean,
): void {
  try {
    if (useGroup) {
      process.kill(-pid, signal);
      return;
    }
  } catch {
    // Group may already be gone or not owned; fall through to direct kill.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already reaped / never started.
  }
}

/**
 * SIGTERM the agent tree immediately; escalate to SIGKILL after grace if still alive.
 * @param child Spawned process (only `pid` / `killed` are required; stdio shape varies).
 * @param useGroup Whether child is a process-group leader (Unix detached).
 * @param graceMs Milliseconds before SIGKILL; timer is unref'd so it won't hold the event loop.
 */
export function disposeAgentProcess(
  child: { pid?: number | undefined; killed: boolean },
  useGroup: boolean,
  graceMs: number = DISPOSE_KILL_GRACE_MS,
): void {
  const pid = child.pid;
  if (!pid || child.killed) {
    return;
  }
  signalAgentTree(pid, "SIGTERM", useGroup);
  const timer = setTimeout(() => {
    try {
      // process.kill(pid, 0) throws if the pid is gone.
      process.kill(pid, 0);
      signalAgentTree(pid, "SIGKILL", useGroup);
    } catch {
      // Tree already exited.
    }
  }, graceMs);
  timer.unref();
}

/**
 * Build argv for `grok [global…] agent [agent…] stdio`.
 * Global SPAWN flags (sandbox / worktree / no-plan / …) must precede `agent`;
 * agent-scoped flags (--model / --always-approve / …) sit between `agent` and `stdio`.
 * @param opts Spawn options including extraArgs mixed from session SPAWN config.
 */
export function buildGrokAgentArgs(opts: SpawnGrokOptions): string[] {
  const globalFlags: string[] = [];
  const agentFlags: string[] = [];
  // Prefer global placement for --no-auto-update (agent subcommand rejects it on some CLIs).
  globalFlags.push("--no-auto-update");
  if (opts.alwaysApprove) {
    agentFlags.push("--always-approve");
  }
  const extras = opts.extraArgs ?? [];
  let i = 0;
  while (i < extras.length) {
    const a = extras[i];
    if (a === undefined) {
      break;
    }
    const next = extras[i + 1];
    const nextIsValue = next !== undefined && !next.startsWith("-");
    const globalKeys = new Set([
      "--sandbox",
      "--worktree",
      "-w",
      "--worktree-ref",
      "--ref",
      "--no-plan",
      "--no-subagents",
      "--no-memory",
      "--max-turns",
      "--rules",
      "--disable-web-search",
      "--tools",
      "--disallowed-tools",
      "--allow",
      "--deny",
      "--permission-mode",
      "--system-prompt-override",
      "--cwd",
    ]);
    const agentKeys = new Set([
      "--model",
      "-m",
      "--always-approve",
      "--reasoning-effort",
      "--effort",
      "--agent-profile",
      "--plugin-dir",
      "--debug",
      "--debug-file",
      "--no-leader",
      "--leader",
    ]);
    if (a === "--no-auto-update") {
      // Already added as global default; skip duplicates.
      i += 1;
      continue;
    }
    if (globalKeys.has(a)) {
      globalFlags.push(a);
      // value-taking flags
      if (
        a !== "--no-plan" &&
        a !== "--no-subagents" &&
        a !== "--no-memory" &&
        a !== "--disable-web-search" &&
        a !== "--worktree" &&
        a !== "-w" &&
        nextIsValue &&
        next !== undefined
      ) {
        // --worktree may be bare or with name; if next looks like a value, take it.
        globalFlags.push(next);
        i += 2;
        continue;
      }
      // bare --worktree
      i += 1;
      continue;
    }
    if (agentKeys.has(a)) {
      agentFlags.push(a);
      if (
        a !== "--always-approve" &&
        a !== "--debug" &&
        a !== "--no-leader" &&
        a !== "--leader" &&
        nextIsValue &&
        next !== undefined
      ) {
        agentFlags.push(next);
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // Unknown flags: put on agent for forward-compat (CLI will error if invalid).
    agentFlags.push(a);
    i += 1;
  }
  return [...globalFlags, "agent", ...agentFlags, "stdio"];
}

/**
 * Start grok agent stdio with cwd locked to the given workspace.
 * Unix: spawn detached so MCP grandchildren share a process group and die with dispose.
 */
export function spawnGrokAgent(opts: SpawnGrokOptions): {
  transport: AcpTransport;
  child: ChildProcessWithoutNullStreams;
  dispose: () => void;
} {
  const bin = resolveGrokBin();
  const args = buildGrokAgentArgs(opts);

  const useGroup = supportsProcessGroup();
  // detached: new process group on Unix so kill(-pid) reaps grok + MCP children together.
  // Do not unref — bridge still owns lifetime via dispose / pool LRU.
  // F-CFG-05: only pass whitelisted env into the agent child (never dump full process.env).
  const childEnv = filterEnvForGrokChild({
    ...process.env,
    ...(opts.env ?? {}),
  });
  const child = spawn(bin, args, {
    stdio: "pipe",
    cwd: opts.cwd,
    env: childEnv,
    detached: useGroup,
  }) as ChildProcessWithoutNullStreams;

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

  const transport: AcpTransport = {
    write: (data) => {
      if (!child.stdin.destroyed) {child.stdin.write(data);}
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
      disposeAgentProcess(child, useGroup);
    },
  };

  return {
    transport,
    child,
    dispose: () => transport.dispose?.(),
  };
}
