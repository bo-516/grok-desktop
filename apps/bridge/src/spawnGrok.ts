/**
 * Spawn `grok agent stdio` and wrap as AcpTransport.
 * Workspace cwd should be the demo folder for constrained runs.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createStdoutLineSplitter,
  type AcpTransport,
} from "@grok-desktop/acp-core";

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
  extraArgs?: string[];
};

/**
 * Start grok agent stdio with cwd locked to the given workspace.
 */
export function spawnGrokAgent(opts: SpawnGrokOptions): {
  transport: AcpTransport;
  child: ChildProcessWithoutNullStreams;
  dispose: () => void;
} {
  const bin = resolveGrokBin();
  // Flags like --always-approve belong on `grok agent`, before the `stdio` subcommand.
  const args = ["agent"];
  if (opts.alwaysApprove) {args.push("--always-approve");}
  if (opts.extraArgs) {args.push(...opts.extraArgs);}
  args.push("stdio");

  const child = spawn(bin, args, {
    stdio: "pipe",
    cwd: opts.cwd,
    env: { ...process.env },
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
      if (!child.killed) {child.kill("SIGTERM");}
    },
  };

  return {
    transport,
    child,
    dispose: () => transport.dispose?.(),
  };
}
