/**
 * Read MCP server stderr logs from ~/.grok/logs/mcp (F-EXT-06).
 * Server names are strictly validated so `..` / absolute segments cannot escape.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

/** MCP server id: letters, digits, dot, underscore, hyphen only. */
const SAFE_SERVER_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Default MCP log directory.
 * @param home HOME override for tests.
 */
export function defaultMcpLogDir(home = process.env.HOME ?? ""): string {
  return path.join(home, ".grok", "logs", "mcp");
}

/**
 * Whether a server name is safe to use as a log basename fragment.
 * @param serverName Candidate MCP server id.
 */
export function isSafeMcpServerName(serverName: string): boolean {
  return (
    typeof serverName === "string" &&
    serverName.length > 0 &&
    serverName.length <= 128 &&
    SAFE_SERVER_NAME.test(serverName) &&
    !serverName.includes("..")
  );
}

/**
 * Resolve log path under the MCP log dir; returns null when unsafe or escapes.
 * @param serverName MCP server id.
 * @param home HOME override.
 */
function resolveMcpLogFile(
  serverName: string,
  home: string,
): string | null {
  if (!isSafeMcpServerName(serverName)) {
    return null;
  }
  const dir = path.resolve(defaultMcpLogDir(home));
  const file = path.resolve(dir, `${serverName}.stderr.log`);
  const rel = path.relative(dir, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return file;
}

/**
 * Read stderr log for a server name.
 * @param serverName MCP server id.
 * @param home HOME override for tests.
 * @returns File text, or empty string when missing / unsafe name.
 */
export async function readMcpStderrLog(
  serverName: string,
  home = process.env.HOME ?? "",
): Promise<string> {
  const file = resolveMcpLogFile(serverName, home);
  if (!file) {
    return "";
  }
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * List available MCP stderr log basenames.
 * @param home HOME override for tests.
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
