/**
 * Agent → client reverse-request handlers (fs + terminal).
 * Unknown methods throw MethodNotImplementedError so AcpClient returns JSON-RPC -32601.
 */

import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { resolveWorkspacePath } from "./workspacePath.js";

/**
 * Terminal child: stdin ignored, stdout/stderr piped for output capture.
 * Matches `stdio: ["ignore", "pipe", "pipe"]` so we never claim a Writable stdin.
 */
export type TerminalChild = ChildProcessByStdio<null, Readable, Readable>;

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
 * Mutable terminal registry for one session runtime.
 * Create/kill reverse methods share this map.
 */
export class TerminalRegistry {
  private readonly terminals = new Map<string, TerminalHandle>();
  private seq = 0;

  /**
   * Spawn a shell command under workspace; tracks output and exit code.
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
    const workCwd = params.cwd
      ? resolveWorkspacePath(workspaceAbs, params.cwd)
      : path.resolve(workspaceAbs);
    const terminalId = `term-${++this.seq}`;
    const args = Array.isArray(params.args) ? params.args.map(String) : [];
    const child = spawn(command, args, {
      cwd: workCwd,
      env: { ...process.env, ...(params.env ?? {}) },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const handle: TerminalHandle = {
      terminalId,
      child,
      output: "",
      exitCode: null,
      cwd: workCwd,
    };
    const limit = params.outputByteLimit ?? 256_000;
    const append = (chunk: Buffer) => {
      handle.output += chunk.toString("utf8");
      if (handle.output.length > limit) {
        handle.output = handle.output.slice(handle.output.length - limit);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("close", (code) => {
      handle.exitCode = code;
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
      const onClose = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        handle.child.removeListener("close", onClose);
        resolve();
      }, timeoutMs);
      handle.child.once("close", onClose);
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
    const text = await readFile(abs, "utf8");
    return { content: text };
  }

  if (method === "fs/write_text_file") {
    const abs = resolveWorkspacePath(workspaceAbs, p.path as string | undefined);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, String(p.content ?? ""), "utf8");
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
