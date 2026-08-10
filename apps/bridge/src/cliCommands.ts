/**
 * High-level grok CLI command wrappers for bridge → desktop channels.
 * Sessions / MCP / inspect / worktree / export / auth / memory / models.
 */

import { assertCliOk, runGrokCli, type CliRunResult } from "./cliRunner.js";
import { listSessionsFromDisk } from "./sessionDiskList.js";

/**
 * List upstream sessions across workspaces.
 * Prefers on-disk `~/.grok/sessions` enumeration (every workspace folder) so
 * the desktop rail is not limited to the currently open session's cwd.
 * Falls back to `grok sessions list` when the disk tree is empty / unreadable.
 * @param cwd Unused for the disk path (kept for CLI signature compatibility).
 *   Pass `scopeCwd` via a future args bag if single-workspace filter is needed.
 */
export async function sessionsList(cwd?: string): Promise<unknown> {
  // Always enumerate all workspaces — rail must show every project with history.
  // `cwd` is intentionally not used as a filter (historical CLI callers passed
  // the open session workspace, which hid other projects in the side-nav).
  void cwd;
  try {
    const disk = await listSessionsFromDisk({ limit: 500 });
    if (disk.length > 0) {
      return {
        sessions: disk.map((row) => ({
          id: row.id,
          title: row.title,
          cwd: row.cwd,
          workspace: row.cwd,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
        })),
      };
    }
  } catch {
    // fall through to CLI
  }

  const result = await runGrokCli(["sessions", "list", "-n", "200"], {
    timeoutMs: 30_000,
  });
  if (result.code !== 0 && !result.json) {
    const plain = await runGrokCli(["sessions", "list", "-n", "200"], {
      timeoutMs: 30_000,
    });
    assertCliOk(plain, "sessions list");
    return {
      raw: plain.stdout,
      lines: plain.stdout.split("\n").filter(Boolean),
    };
  }
  assertCliOk(result, "sessions list");
  return result.json ?? { raw: result.stdout };
}

/**
 * Full-text search sessions.
 * @param query Search string.
 * @param cwd Optional workspace.
 */
export async function sessionsSearch(
  query: string,
  cwd?: string,
): Promise<unknown> {
  const result = await runGrokCli(
    ["sessions", "search", query, "--json"],
    { cwd, timeoutMs: 60_000 },
  );
  if (result.code !== 0) {
    const plain = await runGrokCli(["sessions", "search", query], {
      cwd,
      timeoutMs: 60_000,
    });
    assertCliOk(plain, "sessions search");
    return { raw: plain.stdout };
  }
  return result.json ?? { raw: result.stdout };
}

/**
 * Delete a session permanently (caller must confirm in UI — J-05).
 * @param sessionId Upstream session id.
 */
export async function sessionsDelete(sessionId: string): Promise<CliRunResult> {
  const result = await runGrokCli(
    ["sessions", "delete", sessionId, "--yes"],
    { timeoutMs: 30_000 },
  );
  if (result.code !== 0) {
    return runGrokCli(["sessions", "delete", sessionId], { timeoutMs: 30_000 });
  }
  return result;
}

/**
 * Export session as Markdown.
 * @param sessionId Target session.
 * @param outFile Optional output path; omit for stdout.
 */
export async function sessionsExport(
  sessionId: string,
  outFile?: string,
): Promise<{ markdown: string; path?: string }> {
  const args = outFile
    ? ["export", sessionId, outFile]
    : ["export", sessionId];
  const result = await runGrokCli(args, { timeoutMs: 60_000 });
  assertCliOk(result, "export");
  return { markdown: result.stdout, path: outFile };
}

/**
 * Unified inspect dump (rules / skills / plugins / hooks / MCP).
 * @param cwd Project workspace for project-scoped config.
 */
export async function inspectJson(cwd?: string): Promise<unknown> {
  const result = await runGrokCli(["inspect", "--json"], {
    cwd,
    timeoutMs: 45_000,
  });
  if (result.code !== 0 || !result.json) {
    const plain = await runGrokCli(["inspect"], { cwd, timeoutMs: 45_000 });
    assertCliOk(plain, "inspect");
    return { raw: plain.stdout };
  }
  return result.json;
}

/**
 * List MCP servers.
 * @param cwd Optional project cwd.
 */
export async function mcpList(cwd?: string): Promise<unknown> {
  const result = await runGrokCli(["mcp", "list", "--json"], {
    cwd,
    timeoutMs: 30_000,
  });
  if (result.code !== 0 || !result.json) {
    const plain = await runGrokCli(["mcp", "list"], { cwd, timeoutMs: 30_000 });
    assertCliOk(plain, "mcp list");
    return { raw: plain.stdout };
  }
  return result.json;
}

/**
 * Diagnose one MCP server.
 * @param name Server name.
 * @param cwd Optional project cwd.
 */
export async function mcpDoctor(name: string, cwd?: string): Promise<unknown> {
  const result = await runGrokCli(["mcp", "doctor", name, "--json"], {
    cwd,
    timeoutMs: 120_000,
  });
  if (result.code !== 0 || !result.json) {
    const plain = await runGrokCli(["mcp", "doctor", name], {
      cwd,
      timeoutMs: 120_000,
    });
    return {
      ok: plain.code === 0,
      raw: plain.stdout + plain.stderr,
      code: plain.code,
    };
  }
  return result.json;
}

/**
 * Add stdio MCP server.
 * @param name Server id.
 * @param command Executable.
 * @param args Optional args.
 * @param scope user | project.
 * @param cwd Project cwd when scope=project.
 */
export async function mcpAddStdio(opts: {
  name: string;
  command: string;
  args?: string[];
  scope?: "user" | "project";
  cwd?: string;
}): Promise<CliRunResult> {
  const args = ["mcp", "add", opts.name, opts.command];
  if (opts.args?.length) {
    args.push("--", ...opts.args);
  }
  if (opts.scope === "project") {
    args.push("--scope", "project");
  }
  return runGrokCli(args, { cwd: opts.cwd, timeoutMs: 30_000 });
}

/**
 * Remove MCP server.
 * @param name Server id.
 * @param scope Optional scope.
 * @param cwd Project cwd.
 */
export async function mcpRemove(
  name: string,
  scope?: "user" | "project",
  cwd?: string,
): Promise<CliRunResult> {
  const args = ["mcp", "remove", name];
  if (scope) {
    args.push("--scope", scope);
  }
  return runGrokCli(args, { cwd, timeoutMs: 30_000 });
}

/**
 * List worktrees.
 * @param cwd Git workspace.
 */
export async function worktreeList(cwd?: string): Promise<unknown> {
  const result = await runGrokCli(["worktree", "list", "--json"], {
    cwd,
    timeoutMs: 30_000,
  });
  if (result.code !== 0 || !result.json) {
    const plain = await runGrokCli(["worktree", "list"], {
      cwd,
      timeoutMs: 30_000,
    });
    return { raw: plain.stdout, code: plain.code };
  }
  return result.json;
}

/**
 * Remove worktree (caller confirms — J-05).
 * @param name Worktree name or path.
 * @param dryRun When true, no deletion.
 * @param cwd Git workspace.
 */
export async function worktreeRm(
  name: string,
  dryRun: boolean,
  cwd?: string,
): Promise<CliRunResult> {
  const args = ["worktree", "rm", name];
  if (dryRun) {
    args.push("--dry-run");
  }
  return runGrokCli(args, { cwd, timeoutMs: 60_000 });
}

/**
 * Garbage-collect stale worktrees.
 * @param maxAge e.g. 7d.
 * @param cwd Git workspace.
 */
export async function worktreeGc(
  maxAge = "7d",
  cwd?: string,
): Promise<CliRunResult> {
  return runGrokCli(["worktree", "gc", "--max-age", maxAge], {
    cwd,
    timeoutMs: 60_000,
  });
}

/**
 * List models from CLI for drift checks vs ACP catalog.
 */
export async function modelsList(): Promise<unknown> {
  const result = await runGrokCli(["models", "--json"], { timeoutMs: 30_000 });
  if (result.code !== 0 || !result.json) {
    const plain = await runGrokCli(["models"], { timeoutMs: 30_000 });
    return { raw: plain.stdout, code: plain.code };
  }
  return result.json;
}

/**
 * Clear memory (caller confirms — J-05).
 * @param scope workspace | global | all.
 * @param cwd Workspace when scope=workspace.
 */
export async function memoryClear(
  scope: "workspace" | "global" | "all",
  cwd?: string,
): Promise<CliRunResult> {
  const args = ["memory", "clear", `--${scope === "all" ? "all" : scope}`];
  if (scope === "workspace" || scope === "all") {
    // --workspace may need cwd
  }
  args.push("--yes");
  return runGrokCli(args, { cwd, timeoutMs: 30_000 });
}

/**
 * Trigger browser OIDC login (non-blocking spawn preferred by server).
 */
export async function authLogin(deviceAuth = false): Promise<CliRunResult> {
  const args = deviceAuth
    ? ["login", "--device-auth"]
    : ["login"];
  return runGrokCli(args, { timeoutMs: 300_000 });
}

/**
 * Logout and clear credentials (caller restarts runtimes).
 */
export async function authLogout(): Promise<CliRunResult> {
  return runGrokCli(["logout"], { timeoutMs: 30_000 });
}

/**
 * Check for CLI updates without applying them.
 */
export async function updateCheck(): Promise<unknown> {
  const result = await runGrokCli(["update", "--check"], { timeoutMs: 30_000 });
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Trust project hooks folder (writes trusted_folders.toml via CLI when available).
 * @param folder Absolute project path.
 */
export async function hooksTrust(folder: string): Promise<CliRunResult> {
  // Prefer explicit trust command; fallback to spawn flag is SPAWN-side.
  const tryCmd = await runGrokCli(["hooks", "trust", folder], {
    timeoutMs: 15_000,
  });
  if (tryCmd.code === 0) {
    return tryCmd;
  }
  return runGrokCli(["agent", "--trust", "--help"], { timeoutMs: 5_000 });
}

/**
 * Add HTTP MCP server (F-EXT-03).
 * @param opts name + url + optional headers env.
 */
export async function mcpAddHttp(opts: {
  name: string;
  url: string;
  scope?: "user" | "project";
  cwd?: string;
}): Promise<CliRunResult> {
  const args = ["mcp", "add", opts.name, "--transport", "http", opts.url];
  if (opts.scope === "project") {
    args.push("--scope", "project");
  }
  return runGrokCli(args, { cwd: opts.cwd, timeoutMs: 30_000 });
}

/**
 * Plugin management (F-EXT-11).
 * @param action list|install|uninstall|update|enable|disable|details|validate
 * @param name Optional plugin name.
 */
export async function pluginAction(
  action: string,
  name?: string,
  cwd?: string,
): Promise<unknown> {
  const args = ["plugin", action];
  if (name) {
    args.push(name);
  }
  args.push("--json");
  const result = await runGrokCli(args, { cwd, timeoutMs: 120_000 });
  if (result.code !== 0 || !result.json) {
    const plain = await runGrokCli(
      name ? ["plugin", action, name] : ["plugin", action],
      { cwd, timeoutMs: 120_000 },
    );
    return { code: plain.code, raw: plain.stdout + plain.stderr };
  }
  return result.json;
}

/**
 * Marketplace actions (F-EXT-12).
 */
export async function marketplaceAction(
  action: string,
  name?: string,
): Promise<unknown> {
  const args = ["plugin", "marketplace", action];
  if (name) {
    args.push(name);
  }
  const result = await runGrokCli(args, { timeoutMs: 60_000 });
  return { code: result.code, raw: result.stdout + result.stderr, json: result.json };
}
