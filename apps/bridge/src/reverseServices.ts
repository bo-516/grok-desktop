/**
 * Agent → client reverse-request handlers (fs + terminal).
 * Unknown methods throw MethodNotImplementedError so AcpClient returns JSON-RPC -32601.
 * Terminal env uses the same whitelist as grok children (F-CFG-05); paths are realpath-sandboxed.
 */

import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { filterEnvForGrokChild } from "./envWhitelist.js";
import { resolveWorkspacePath } from "./workspacePath.js";

/**
 * Terminal child: stdin ignored, stdout/stderr piped for output capture.
 * Matches `stdio: ["ignore", "pipe", "pipe"]` so we never claim a Writable stdin.
 */
export type TerminalChild = ChildProcessByStdio<null, Readable, Readable>;

/** Hard ceiling on reverse fs/read_text_file body size (bytes). */
export const MAX_REVERSE_READ_BYTES = 10 * 1024 * 1024;

/** Default terminal output ring size when agent omits outputByteLimit. */
export const DEFAULT_TERMINAL_OUTPUT_BYTES = 256_000;

/** Absolute max terminal output retained (agent cannot exceed). */
export const MAX_TERMINAL_OUTPUT_BYTES = 1_000_000;

/** Max concurrent terminals per session registry. */
export const MAX_TERMINALS_PER_SESSION = 16;

/** JSON-RPC method-not-found surface for reverse handlers. */
export class MethodNotImplementedError extends Error {
  readonly code = -32601;
  readonly method: string;

  /**
   * @param method Reverse method name (included in message for agent diagnostics).
   */
  constructor(method: string) {
    super(`Method not found: ${method}`);
    this.name = "MethodNotImplementedError";
    this.method = method;
  }
}

/** Live terminal process tracked for kill/output. */
export type TerminalHandle = {
  terminalId: string;
  child: TerminalChild;
  output: string;
  exitCode: number | null;
  cwd: string;
};

/**
 * Clamp agent-requested outputByteLimit into a safe range.
 * @param requested Agent value; non-finite / missing → default.
 * @returns Integer byte cap in [1, MAX_TERMINAL_OUTPUT_BYTES].
 */
export function clampTerminalOutputLimit(requested: unknown): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) {
    return DEFAULT_TERMINAL_OUTPUT_BYTES;
  }
  const n = Math.floor(requested);
  if (n <= 0) {
    return DEFAULT_TERMINAL_OUTPUT_BYTES;
  }
  return Math.min(n, MAX_TERMINAL_OUTPUT_BYTES);
}

/**
 * Mutable terminal registry for one session runtime.
 * Create/kill reverse methods share this map.
 */
export class TerminalRegistry {
  private readonly terminals = new Map<string, TerminalHandle>();
  private seq = 0;

  /**
   * Spawn a shell command under workspace; tracks output and exit code.
   * Agents may pass either argv form (`command` + `args`) or a full shell line
   * in `command` alone (e.g. `/bin/bash -lc '…'`). The latter must use
   * `shell: true` — with `shell: false` Node treats the whole string as the
   * executable path, gets ENOENT, and without an `error` listener that event
   * crashes the entire bridge process (unhandled 'error' on ChildProcess).
   * Env is filtered with {@link filterEnvForGrokChild} so reverse shells cannot
   * inherit secrets withheld from the agent process (F-CFG-05).
   * @param workspaceAbs Session cwd.
   * @param params Agent terminal/create params (command, args, cwd, env optional).
   * @returns terminalId for subsequent wait/kill.
   */
  create(
    workspaceAbs: string,
    params: {
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
      outputByteLimit?: number;
    },
  ): { terminalId: string } {
    const command = params.command?.trim();
    if (!command) {
      throw new Error("terminal/create requires command");
    }
    if (this.terminals.size >= MAX_TERMINALS_PER_SESSION) {
      // Evict oldest finished terminal first; if all live, kill the oldest.
      const oldestId = this.terminals.keys().next().value;
      if (oldestId) {
        this.kill(oldestId);
      }
    }
    const workCwd = params.cwd
      ? resolveWorkspacePath(workspaceAbs, params.cwd)
      : path.resolve(workspaceAbs);
    const terminalId = `term-${++this.seq}`;
    const args = Array.isArray(params.args) ? params.args.map(String) : [];
    /**
     * Full command line with no argv: run via the platform shell so spaces and
     * shell metacharacters are parsed. Explicit argv stays shell:false so a
     * single binary path is not re-tokenized.
     *
     * Agents frequently send `/bin/bash -lc '…'` as one string (no args). With
     * shell:false Node treats that entire string as the executable path →
     * ENOENT, and without an `error` listener the bridge process dies.
     */
    const useShell = args.length === 0 && /\s/.test(command);
    // Whitelist parent env, then re-filter agent overrides so only GROK_/XAI_/
    // always-pass keys survive (never raw process.env + arbitrary agent keys).
    const env = filterEnvForGrokChild({
      ...filterEnvForGrokChild(process.env),
      ...(params.env ?? {}),
    });
    const child = spawn(command, args, {
      cwd: workCwd,
      env,
      shell: useShell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handle: TerminalHandle = {
      terminalId,
      child,
      output: "",
      exitCode: null,
      cwd: workCwd,
    };
    const limit = clampTerminalOutputLimit(params.outputByteLimit);
    const append = (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      handle.output += text;
      if (handle.output.length > limit) {
        handle.output = handle.output.slice(handle.output.length - limit);
      }
    };
    /**
     * Attach `error` before any other listeners: spawn failures (ENOENT,
     * EACCES, …) emit `error` and often never emit a useful `close`. Unhandled
     * → process-level crash of the whole bridge.
     */
    child.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      append(`\n[bridge terminal] spawn failed: ${message}\n`);
      if (handle.exitCode === null) {
        handle.exitCode = 1;
      }
    });
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("close", (code) => {
      // Keep a prior spawn-error exitCode if close fires with null afterward.
      if (handle.exitCode === null) {
        handle.exitCode = code;
      }
    });
    this.terminals.set(terminalId, handle);
    return { terminalId };
  }

  /**
   * Snapshot current output / exit for a terminal.
   * @param terminalId From create.
   */
  get(terminalId: string): TerminalHandle | undefined {
    return this.terminals.get(terminalId);
  }

  /**
   * Wait until process exits or timeout.
   * Listens for both `close` and `error`: a failed spawn (ENOENT) sets
   * exitCode on `error` and may never emit `close`, so waiting only on close
   * would hang until timeout.
   * @param terminalId Target.
   * @param timeoutMs Optional max wait; 0 = poll once.
   */
  async wait(
    terminalId: string,
    timeoutMs = 30_000,
  ): Promise<{ output: string; exitCode: number | null; truncated: boolean }> {
    const handle = this.terminals.get(terminalId);
    if (!handle) {
      throw new Error(`unknown terminal: ${terminalId}`);
    }
    if (handle.exitCode !== null || handle.child.killed) {
      return {
        output: handle.output,
        exitCode: handle.exitCode,
        truncated: false,
      };
    }
    await new Promise<void>((resolve) => {
      const onDone = () => {
        clearTimeout(timer);
        handle.child.removeListener("close", onDone);
        handle.child.removeListener("error", onDone);
        resolve();
      };
      const timer = setTimeout(onDone, timeoutMs);
      handle.child.once("close", onDone);
      // Spawn failures resolve here; create()'s error handler already wrote exitCode.
      handle.child.once("error", onDone);
    });
    return {
      output: handle.output,
      exitCode: handle.exitCode,
      truncated: false,
    };
  }

  /**
   * Kill a terminal process and drop registry entry.
   * @param terminalId Target.
   */
  kill(terminalId: string): { ok: boolean } {
    const handle = this.terminals.get(terminalId);
    if (!handle) {
      return { ok: false };
    }
    try {
      handle.child.kill("SIGTERM");
    } catch {
      /* already dead */
    }
    this.terminals.delete(terminalId);
    return { ok: true };
  }

  /** Release all children (session dispose). */
  disposeAll(): void {
    for (const id of [...this.terminals.keys()]) {
      this.kill(id);
    }
  }
}

/**
 * Dispatch a reverse method for one workspace session.
 * @param method JSON-RPC method from agent.
 * @param params Request params.
 * @param workspaceAbs Session cwd (absolute).
 * @param terminals Shared terminal registry (required when terminal capability is on).
 * @returns Result object for JSON-RPC success response.
 * @throws MethodNotImplementedError for unknown methods; Error for fs boundary / IO failures.
 */
export async function handleReverseRequest(
  method: string,
  params: unknown,
  workspaceAbs: string,
  terminals: TerminalRegistry,
): Promise<unknown> {
  const p = (params ?? {}) as Record<string, unknown>;

  if (method === "fs/read_text_file") {
    const abs = resolveWorkspacePath(workspaceAbs, p.path as string | undefined);
    const st = await stat(abs);
    if (st.isDirectory()) {
      throw new Error(`path is a directory: ${String(p.path ?? "")}`);
    }
    if (st.size > MAX_REVERSE_READ_BYTES) {
      throw new Error(
        `file too large for reverse read (${st.size} > ${MAX_REVERSE_READ_BYTES})`,
      );
    }
    const text = await readFile(abs, "utf8");
    return { content: text };
  }

  if (method === "fs/write_text_file") {
    const content = String(p.content ?? "");
    if (Buffer.byteLength(content, "utf8") > MAX_REVERSE_READ_BYTES) {
      throw new Error(
        `content too large for reverse write (> ${MAX_REVERSE_READ_BYTES})`,
      );
    }
    const abs = resolveWorkspacePath(workspaceAbs, p.path as string | undefined);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
    return {};
  }

  if (method === "terminal/create") {
    return terminals.create(workspaceAbs, {
      command: p.command as string | undefined,
      args: p.args as string[] | undefined,
      cwd: p.cwd as string | undefined,
      env: p.env as Record<string, string> | undefined,
      outputByteLimit: p.outputByteLimit as number | undefined,
    });
  }

  if (
    method === "terminal/output" ||
    method === "terminal/wait_for_exit" ||
    method === "terminal/wait"
  ) {
    const terminalId = String(p.terminalId ?? p.id ?? "");
    let timeoutMs = 30_000;
    if (typeof p.timeoutMs === "number") {
      timeoutMs = p.timeoutMs;
    } else if (method === "terminal/output") {
      timeoutMs = 0;
    }
    return terminals.wait(terminalId, timeoutMs);
  }

  if (method === "terminal/kill" || method === "terminal/release") {
    const terminalId = String(p.terminalId ?? p.id ?? "");
    return terminals.kill(terminalId);
  }

  throw new MethodNotImplementedError(method);
}
