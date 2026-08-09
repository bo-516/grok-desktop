/**
 * One-shot `grok <subcommand>` runner for bridge CLI channel features.
 * Prefer --json when the subcommand supports it; capture stdout for UI panels.
 */

import { spawn } from "node:child_process";
import { resolveGrokBin } from "./spawnGrok.js";

export type CliRunResult = {
  /** Process exit code (null if killed before exit). */
  code: number | null;
  /** Combined utf8 stdout. */
  stdout: string;
  /** Combined utf8 stderr. */
  stderr: string;
  /** Parsed JSON when stdout is valid JSON (or NDJSON last object). */
  json: unknown | null;
};

/**
 * Run grok with args; resolve when child exits or timeout fires.
 * @param args Args after binary (e.g. ["sessions", "list", "--json"]).
 * @param opts cwd / timeoutMs / env overrides.
 * @returns Captured stdout/stderr and optional parsed JSON.
 */
export function runGrokCli(
  args: string[],
  opts: {
    cwd?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CliRunResult> {
  const bin = resolveGrokBin();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      if (!settled) {
        settled = true;
        reject(new Error(`grok ${args.join(" ")} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      resolve({
        code,
        stdout,
        stderr,
        json: tryParseJson(stdout),
      });
    });
  });
}

/**
 * Parse JSON or last NDJSON object from CLI stdout.
 * @param text Raw stdout.
 * @returns Parsed value or null.
 */
export function tryParseJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // NDJSON: last non-empty line
    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]!);
      } catch {
        /* continue */
      }
    }
    return null;
  }
}

/**
 * Ensure CLI succeeded (exit 0); otherwise throw with stderr/stdout.
 * @param result From runGrokCli.
 * @param label Human label for error messages.
 */
export function assertCliOk(result: CliRunResult, label: string): void {
  if (result.code === 0) {
    return;
  }
  const detail = (result.stderr || result.stdout || "unknown error").trim();
  throw new Error(`${label} failed (exit ${result.code}): ${detail.slice(0, 500)}`);
}
