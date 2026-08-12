/**
 * MCP list / doctor normalization and mergeMcpRows for the Environment sheet.
 * Keeps CLI snake_case out of the store and UI.
 */

import type { ItemSource, McpHealth, McpRow } from "./inspectModelTypes.js";
import { normalizeSource } from "./inspectNormalize.js";
import {
  asArray,
  asRecord,
  bool,
  mapRows,
  num,
  str,
} from "./inspectParseUtils.js";

/**
 * Normalize transport string to a closed set.
 * @param raw CLI transport field.
 */
function normalizeTransport(raw: string): McpRow["transport"] {
  if (raw === "stdio" || raw === "http" || raw === "sse") {
    return raw;
  }
  return "unknown";
}

/**
 * Extract env KEY names (values discarded / masked) from a config MCP entry.
 * @param env Raw env object or KEY=value string array.
 */
function envKeysFrom(env: unknown): string[] | undefined {
  if (env == null) {
    return undefined;
  }
  if (Array.isArray(env)) {
    const keys = env
      .map((entry) => {
        if (typeof entry !== "string") {
          return "";
        }
        const eq = entry.indexOf("=");
        return eq >= 0 ? entry.slice(0, eq) : entry;
      })
      .filter(Boolean);
    return keys.length ? keys : undefined;
  }
  const obj = asRecord(env);
  if (!obj) {
    return undefined;
  }
  const keys = Object.keys(obj);
  return keys.length ? keys : undefined;
}

/**
 * Extract HTTP header names from a config MCP entry.
 * @param headers Raw headers object or "Name: Value" string array.
 */
function headerNamesFrom(headers: unknown): string[] | undefined {
  if (headers == null) {
    return undefined;
  }
  if (Array.isArray(headers)) {
    const names = headers
      .map((entry) => {
        if (typeof entry !== "string") {
          return "";
        }
        const colon = entry.indexOf(":");
        return colon >= 0 ? entry.slice(0, colon).trim() : entry.trim();
      })
      .filter(Boolean);
    return names.length ? names : undefined;
  }
  const obj = asRecord(headers);
  if (!obj) {
    return undefined;
  }
  const names = Object.keys(obj);
  return names.length ? names : undefined;
}

/**
 * Parse one config MCP server from `mcp list --json`.
 * Accepts object rows; ignores non-objects. Values of env/headers are never kept.
 * @param raw One list element.
 */
function normalizeConfigMcp(raw: unknown): McpRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  const scopeRaw = str(obj, "scope");
  const scope: McpRow["scope"] =
    scopeRaw === "user" || scopeRaw === "project"
      ? scopeRaw
      : scopeRaw
        ? "unknown"
        : undefined;
  const enabled =
    typeof obj.enabled === "boolean" ? obj.enabled : undefined;
  const source =
    obj.source != null
      ? normalizeSource(
          typeof obj.source === "string"
            ? { type: "unknown", path: obj.source }
            : obj.source,
        )
      : { kind: "user" as const };
  const row: McpRow = {
    name,
    transport: normalizeTransport(str(obj, "transport")),
    target: str(obj, "target") || str(obj, "command") || str(obj, "url"),
    source,
  };
  if (enabled !== undefined) {
    row.enabled = enabled;
  }
  if (scope) {
    row.scope = scope;
  }
  const keys = envKeysFrom(obj.env ?? obj.environment);
  if (keys) {
    row.envKeys = keys;
  }
  const headers = headerNamesFrom(obj.headers);
  if (headers) {
    row.headerNames = headers;
  }
  return row;
}

/**
 * Normalize `mcp list --json` payload into config MCP rows.
 * Handles bare arrays and `{ servers: [...] }` wrappers; `{ raw }` yields [].
 * @param configServers Unknown list payload.
 */
export function normalizeMcpList(configServers: unknown): McpRow[] {
  if (configServers == null) {
    return [];
  }
  if (typeof configServers === "string") {
    return [];
  }
  const root = asRecord(configServers);
  if (root && typeof root.raw === "string" && root.servers == null) {
    return [];
  }
  const list = Array.isArray(configServers)
    ? configServers
    : root
      ? asArray(root.servers ?? root.mcpServers)
      : [];
  return mapRows(list, normalizeConfigMcp);
}

/**
 * Parse doctor payload (snake_case CLI) into a name → McpHealth map.
 * @param doctor Unknown `mcp doctor` JSON (single or multi-server).
 * @returns Map keyed by server name; empty when shape is unusable.
 */
export function normalizeDoctorHealth(
  doctor: unknown,
): Record<string, McpHealth> {
  const out: Record<string, McpHealth> = {};
  if (doctor == null || typeof doctor === "string") {
    return out;
  }
  const root = asRecord(doctor);
  if (!root) {
    return out;
  }
  // Single-server doctor sometimes is the server object itself.
  const servers = asArray(root.servers);
  const items =
    servers.length > 0
      ? servers
      : typeof root.name === "string"
        ? [root]
        : [];
  for (const item of items) {
    const obj = asRecord(item);
    if (!obj) {
      continue;
    }
    const name = str(obj, "name");
    if (!name) {
      continue;
    }
    const checks = asArray(obj.checks).map((c) => {
      const cObj = asRecord(c);
      return {
        label: str(cObj, "label"),
        passed: bool(cObj, "passed", false),
        detail: str(cObj, "detail"),
      };
    });
    const healthy = bool(obj, "healthy", checks.every((c) => c.passed));
    const healthyCount =
      num(root, "healthy_count") ?? num(root, "healthyCount");
    const failingCount =
      num(root, "failing_count") ?? num(root, "failingCount");
    let summary = healthy ? "healthy" : "failing";
    if (checks.length > 0) {
      const passed = checks.filter((c) => c.passed).length;
      summary = `${passed}/${checks.length} checks passed`;
    } else if (healthyCount != null || failingCount != null) {
      summary = `healthy=${healthyCount ?? "?"}, failing=${failingCount ?? "?"}`;
    }
    out[name] = { healthy, summary, checks };
  }
  return out;
}

/**
 * Merge the three MCP views into one row set, keyed by server name.
 * Precedence: `inspect` decides which servers exist and their provenance
 * (it is the only source that sees plugin-provided servers — see D3);
 * `mcp list` contributes config-only fields (enabled, scope, env, headers);
 * `doctor` contributes health. Servers present only in `mcp list` are kept
 * and marked inactive, so a disabled config entry does not silently vanish.
 * @param inspectServers Normalized inspect.mcpServers rows.
 * @param configServers Raw `mcp list` payload (normalized inside).
 * @param doctor Optional raw or pre-normalized doctor map/object.
 * @returns Merged rows sorted by name.
 */
export function mergeMcpRows(
  inspectServers: McpRow[],
  configServers: unknown,
  doctor?: unknown,
): McpRow[] {
  const configRows = normalizeMcpList(configServers);
  const healthMap: Record<string, McpHealth> =
    doctor != null &&
    typeof doctor === "object" &&
    !Array.isArray(doctor) &&
    !("servers" in (doctor as object)) &&
    !("name" in (doctor as object)) &&
    !("healthy_count" in (doctor as object)) &&
    !("healthyCount" in (doctor as object))
      ? (doctor as Record<string, McpHealth>)
      : normalizeDoctorHealth(doctor);

  const byName = new Map<string, McpRow>();

  for (const row of inspectServers) {
    byName.set(row.name, { ...row });
  }

  for (const cfg of configRows) {
    const existing = byName.get(cfg.name);
    if (existing) {
      const merged: McpRow = { ...existing };
      if (cfg.enabled !== undefined) {
        merged.enabled = cfg.enabled;
      }
      if (cfg.scope) {
        merged.scope = cfg.scope;
      }
      if (cfg.envKeys) {
        merged.envKeys = cfg.envKeys;
      }
      if (cfg.headerNames) {
        merged.headerNames = cfg.headerNames;
      }
      // Prefer richer target from config when inspect only has a short command.
      if (cfg.target && (!existing.target || existing.target.length < cfg.target.length)) {
        merged.target = cfg.target;
      }
      if (cfg.transport !== "unknown" && existing.transport === "unknown") {
        merged.transport = cfg.transport;
      }
      byName.set(cfg.name, merged);
    } else {
      byName.set(cfg.name, { ...cfg, inactive: true });
    }
  }

  for (const [name, health] of Object.entries(healthMap)) {
    const existing = byName.get(name);
    if (!existing) {
      // Doctor for a name not in either list ⇒ ignore (no crash, no phantom row).
      continue;
    }
    byName.set(name, { ...existing, health });
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Format a provenance chip label for UI.
 * @param source Item source.
 * @returns Short label such as `plugin: browser-use` or `bundled`.
 */
export function sourceChipLabel(source: ItemSource): string {
  if (source.kind === "plugin" && source.pluginName) {
    return `plugin: ${source.pluginName}`;
  }
  return source.kind;
}

/**
 * Status vocabulary for MCP / plugin rows.
 * @param row MCP row after merge.
 * @returns Status key for the status dot.
 */
export function mcpStatusKind(
  row: McpRow,
): "healthy" | "failing" | "disabled" | "unchecked" {
  if (row.enabled === false || row.inactive) {
    return "disabled";
  }
  if (!row.health) {
    return "unchecked";
  }
  return row.health.healthy ? "healthy" : "failing";
}
