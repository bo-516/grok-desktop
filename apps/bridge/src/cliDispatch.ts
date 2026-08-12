/**
 * Dispatch bridge `cli` WebSocket messages to one-shot grok CLI wrappers.
 */

import * as cli from "./cliCommands.js";
import type { PromptEntry, PromptScope } from "./userPromptsFormat.js";
import {
  promptsClear,
  promptsGet,
  promptsMove,
  promptsSet,
} from "./userPrompts.js";

/**
 * Run a named CLI channel command.
 * @param command Command id from ClientMsg.cli.
 * @param args Free-form args bag from UI.
 * @param cwd Optional workspace.
 * @returns Data for cli_result payload.
 */
export async function dispatchCliCommand(
  command: string,
  args: Record<string, unknown> = {},
  cwd?: string,
): Promise<unknown> {
  switch (command) {
    case "inspect":
      return cli.inspectJson(cwd);
    case "sessions_list":
      return cli.sessionsList(cwd);
    case "sessions_search":
      return cli.sessionsSearch(String(args.query ?? ""), cwd);
    case "sessions_delete":
      return cli.sessionsDelete(String(args.sessionId ?? ""));
    case "export":
      return cli.sessionsExport(
        String(args.sessionId ?? ""),
        args.outFile ? String(args.outFile) : undefined,
      );
    case "mcp_list":
      return cli.mcpList(cwd);
    case "mcp_doctor":
      return cli.mcpDoctor(String(args.name ?? ""), cwd);
    case "mcp_add_stdio":
      return cli.mcpAddStdio({
        name: String(args.name ?? ""),
        command: String(args.command ?? ""),
        args: Array.isArray(args.cmdArgs)
          ? args.cmdArgs.map(String)
          : undefined,
        env: Array.isArray(args.env) ? args.env.map(String) : undefined,
        scope: args.scope === "project" ? "project" : "user",
        cwd,
      });
    case "mcp_enable":
      return cli.mcpEnable(String(args.name ?? ""), cwd);
    case "mcp_disable":
      return cli.mcpDisable(String(args.name ?? ""), cwd);
    case "mcp_remove":
      return cli.mcpRemove(
        String(args.name ?? ""),
        args.scope === "project" ? "project" : "user",
        cwd,
      );
    case "worktree_list":
      return cli.worktreeList(cwd);
    case "worktree_rm":
      return cli.worktreeRm(
        String(args.name ?? ""),
        Boolean(args.dryRun),
        cwd,
      );
    case "worktree_gc":
      return cli.worktreeGc(String(args.maxAge ?? "7d"), cwd);
    case "models_list":
      return cli.modelsList();
    case "memory_clear":
      return cli.memoryClear(
        (args.scope as "workspace" | "global" | "all") ?? "workspace",
        cwd,
      );
    case "auth_login":
      return cli.authLogin(Boolean(args.deviceAuth));
    case "auth_logout":
      return cli.authLogout();
    case "update_check":
      return cli.updateCheck();
    case "mcp_add_http":
      return cli.mcpAddHttp({
        name: String(args.name ?? ""),
        url: String(args.url ?? ""),
        headers: Array.isArray(args.headers)
          ? args.headers.map(String)
          : undefined,
        transport: args.transport === "sse" ? "sse" : "http",
        scope: args.scope === "project" ? "project" : "user",
        cwd,
      });
    case "plugin":
      return cli.pluginAction(
        String(args.action ?? "list"),
        args.name ? String(args.name) : undefined,
        cwd,
      );
    case "marketplace":
      return cli.marketplaceAction(
        String(args.action ?? "list"),
        args.name ? String(args.name) : undefined,
      );
    case "mcp_stderr_log": {
      const { readMcpStderrLog, listMcpStderrLogs } = await import(
        "./mcpLogReader.js"
      );
      if (args.list) {
        return listMcpStderrLogs();
      }
      return {
        name: String(args.name ?? ""),
        content: await readMcpStderrLog(String(args.name ?? "")),
      };
    }
    case "import_claude": {
      const result = await import("./cliRunner.js").then((m) =>
        m.runGrokCli(["import"], { cwd, timeoutMs: 120_000 }),
      );
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    }
    case "prompts_get":
      // Paths derived only from GROK_HOME + project root of cwd — ignore any path args.
      return promptsGet(cwd);
    case "prompts_set": {
      const scope = String(args.scope ?? "") as PromptScope;
      const entries = coercePromptEntries(args.entries);
      return promptsSet(scope, entries, cwd);
    }
    case "prompts_clear": {
      const scope = String(args.scope ?? "") as PromptScope;
      return promptsClear(scope, cwd);
    }
    case "prompts_move": {
      const from = String(args.from ?? "") as PromptScope;
      const to = String(args.to ?? "") as PromptScope;
      const entryIndex = Number(args.entryIndex);
      return promptsMove(from, to, entryIndex, cwd);
    }
    default:
      throw new Error(`unknown cli command: ${command}`);
  }
}

/**
 * Coerce free-form CLI args.entries into PromptEntry[].
 * @param raw Unknown bag from the client.
 */
function coercePromptEntries(raw: unknown): PromptEntry[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.map((item, i) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const category =
      typeof o.category === "string" && o.category
        ? (o.category as PromptEntry["category"])
        : undefined;
    return {
      id: typeof o.id === "string" && o.id ? o.id : `e${i}`,
      text: String(o.text ?? ""),
      enabled: o.enabled !== false,
      ...(category ? { category } : {}),
    };
  });
}
