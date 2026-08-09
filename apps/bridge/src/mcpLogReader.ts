/**
 * Read MCP server stderr logs from ~/.grok/logs/mcp (F-EXT-06).
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Default MCP log directory.
 */
export function defaultMcpLogDir(home = process.env.HOME ?? ""): string {
  return path.join(home, ".grok", "logs", "mcp");
}

/**
 * Read stderr log for a server name.
 * @param serverName MCP server id.
 * @param home HOME override for tests.
 */
export async function readMcpStderrLog(
  serverName: string,
  home = process.env.HOME ?? "",
): Promise<string> {
  const file = path.join(defaultMcpLogDir(home), `${serverName}.stderr.log`);
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * List available MCP stderr log basenames.
 */
export async function listMcpStderrLogs(
  home = process.env.HOME ?? "",
): Promise<string[]> {
  const dir = defaultMcpLogDir(home);
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith(".stderr.log"));
  } catch {
    return [];
  }
}
