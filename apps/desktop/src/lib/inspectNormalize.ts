/**
 * Normalize `grok inspect --json` into the desktop InspectSnapshot model.
 * Accepts bridge `{ raw }` fallback and mistyped fields without throwing.
 */

import type {
  AgentRow,
  CompatCell,
  ConfigLayer,
  ConfigWarning,
  HookRow,
  InspectSnapshot,
  InstructionRow,
  ItemSource,
  LspRow,
  MarketplaceRow,
  McpRow,
  PluginRow,
  SkillRow,
  SourceKind,
} from "./inspectModelTypes.js";
import {
  asRecord,
  bool,
  mapRows,
  num,
  str,
} from "./inspectParseUtils.js";

/** Known SourceKind set for validation. */
const SOURCE_KINDS = new Set<SourceKind>([
  "bundled",
  "user",
  "project",
  "plugin",
  "builtin",
  "marketplace",
  "unknown",
]);

/**
 * Mask a secret-looking value for display (env values, header values).
 * @param value Raw string; empty stays empty.
 * @returns Bullet mask when non-empty.
 */
export function maskSecret(value: string): string {
  if (!value) {
    return value;
  }
  return "••••";
}

/**
 * Normalize a CLI `source` object (inspect uses `type` + optional `plugin_name`).
 * Unknown type strings become `unknown` without throwing.
 * @param raw Source field from any inspect domain.
 * @returns Typed ItemSource.
 */
export function normalizeSource(raw: unknown): ItemSource {
  const obj = asRecord(raw);
  if (!obj) {
    return { kind: "unknown" };
  }
  const typeRaw = str(obj, "type") || str(obj, "kind");
  const kind: SourceKind = SOURCE_KINDS.has(typeRaw as SourceKind)
    ? (typeRaw as SourceKind)
    : "unknown";
  const path = str(obj, "path") || undefined;
  const pluginName =
    str(obj, "pluginName") || str(obj, "plugin_name") || undefined;
  const out: ItemSource = { kind };
  if (path) {
    out.path = path;
  }
  if (pluginName) {
    out.pluginName = pluginName;
  }
  return out;
}

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
 * Normalize one inspect MCP server entry (existence + provenance).
 * @param raw One element of inspect.mcpServers.
 */
function normalizeInspectMcp(raw: unknown): McpRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  return {
    name,
    transport: normalizeTransport(str(obj, "transport")),
    target: str(obj, "target"),
    source: normalizeSource(obj.source),
  };
}

/**
 * Normalize one skill row.
 * @param raw One element of inspect.skills.
 */
function normalizeSkill(raw: unknown): SkillRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  return {
    name,
    description: str(obj, "description"),
    source: normalizeSource(obj.source),
    userInvocable: bool(obj, "userInvocable", false),
  };
}

/**
 * Normalize one agent row.
 * @param raw One element of inspect.agents.
 */
function normalizeAgent(raw: unknown): AgentRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  return {
    name,
    description: str(obj, "description"),
    source: normalizeSource(obj.source),
  };
}

/**
 * Normalize one plugin row from inspect.
 * @param raw One element of inspect.plugins.
 */
function normalizePlugin(raw: unknown): PluginRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  const providesObj = asRecord(obj.provides);
  const scopeRaw = str(obj, "scope");
  const scope: PluginRow["scope"] =
    scopeRaw === "user" || scopeRaw === "project" ? scopeRaw : "unknown";
  return {
    name,
    version: str(obj, "version") || undefined,
    scope,
    enabled: bool(obj, "enabled", true),
    path: str(obj, "path") || undefined,
    marketplace: str(obj, "marketplace") || undefined,
    provides: {
      skills: num(providesObj, "skills") ?? 0,
      agents: num(providesObj, "agents") ?? 0,
      hooks: bool(providesObj, "hooks", false),
      mcpServers: num(providesObj, "mcpServers") ?? 0,
    },
  };
}

/**
 * Normalize one marketplace row.
 * @param raw One element of inspect.marketplaces.
 */
function normalizeMarketplace(raw: unknown): MarketplaceRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  return {
    name,
    url: str(obj, "url") || str(obj, "gitUrl") || str(obj, "git_url") || undefined,
    source: obj.source != null ? normalizeSource(obj.source) : undefined,
  };
}

/**
 * Normalize one hook row.
 * @param raw One element of inspect.hooks.
 */
function normalizeHook(raw: unknown): HookRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const event = str(obj, "event") || str(obj, "name");
  if (!event) {
    return null;
  }
  return {
    event,
    matcher: str(obj, "matcher") || undefined,
    command: str(obj, "command") || str(obj, "handler") || undefined,
    source: normalizeSource(obj.source),
  };
}

/**
 * Normalize one project instruction row.
 * @param raw One element of inspect.projectInstructions.
 */
function normalizeInstruction(raw: unknown): InstructionRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const path = str(obj, "path");
  if (!path) {
    return null;
  }
  return {
    path,
    scope: str(obj, "scope"),
    fileType: str(obj, "fileType") || str(obj, "file_type"),
    approxTokens: num(obj, "approxTokens") ?? num(obj, "approx_tokens"),
    sizeBytes: num(obj, "sizeBytes") ?? num(obj, "size_bytes"),
  };
}

/**
 * Normalize one config layer.
 * @param raw One element of configSources.layers.
 */
function normalizeLayer(raw: unknown): ConfigLayer | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const path = str(obj, "path");
  if (!path) {
    return null;
  }
  return {
    role: str(obj, "role") || str(obj, "scope") || "unknown",
    path,
  };
}

/**
 * Normalize one config warning.
 * @param raw One element of configWarnings.
 */
function normalizeWarning(raw: unknown): ConfigWarning | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  return {
    target: str(obj, "target"),
    path: str(obj, "path"),
    kind: str(obj, "kind"),
    reason: str(obj, "reason"),
  };
}

/**
 * Normalize one external-compat cell.
 * @param raw One element of externalCompat.cells.
 */
function normalizeCompatCell(raw: unknown): CompatCell | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const vendor = str(obj, "vendor");
  const surface = str(obj, "surface");
  if (!vendor || !surface) {
    return null;
  }
  return {
    vendor,
    surface,
    enabled: bool(obj, "enabled", true),
    source: str(obj, "source") || "default",
  };
}

/**
 * Normalize one LSP server entry.
 * @param raw One element of lspServers.
 */
function normalizeLsp(raw: unknown): LspRow | null {
  const obj = asRecord(raw);
  if (!obj) {
    return null;
  }
  const name = str(obj, "name");
  if (!name) {
    return null;
  }
  return {
    name,
    source: normalizeSource(obj.source),
  };
}

/**
 * Empty snapshot used for raw fallback / total failure.
 * @param rawFallback Optional bridge text payload.
 */
function emptySnapshot(rawFallback?: string): InspectSnapshot {
  const snap: InspectSnapshot = {
    grokVersion: "",
    channel: "",
    cwd: "",
    projectRoot: "",
    projectTrusted: false,
    instructions: [],
    hooks: [],
    skills: [],
    agents: [],
    plugins: [],
    marketplaces: [],
    mcpServers: [],
    lspServers: [],
    configLayers: [],
    warnings: [],
    compat: [],
  };
  if (rawFallback != null && rawFallback !== "") {
    snap.rawFallback = rawFallback;
  }
  return snap;
}

/**
 * Normalize `grok inspect --json` into the desktop model.
 * Accepts the bridge's `{ raw: string }` text fallback and any missing /
 * mistyped field; unknown source types degrade to "unknown" rather than
 * throwing, so one CLI change cannot blank the whole sheet.
 * @param raw Unknown payload from the CLI channel.
 * @returns A fully-populated snapshot; arrays are always arrays.
 */
export function normalizeInspect(raw: unknown): InspectSnapshot {
  if (raw == null) {
    return emptySnapshot();
  }
  if (typeof raw === "string") {
    return emptySnapshot(raw);
  }
  const root = asRecord(raw);
  if (!root) {
    return emptySnapshot();
  }
  // Bridge text fallback: { raw: "..." } with no structured fields.
  if (typeof root.raw === "string" && root.mcpServers == null && root.skills == null) {
    return emptySnapshot(root.raw);
  }

  const configSources = asRecord(root.configSources);
  const layersRaw = configSources?.layers;
  const externalCompat = asRecord(root.externalCompat);
  const compatCells =
    externalCompat != null
      ? externalCompat.cells
      : Array.isArray(root.externalCompat)
        ? root.externalCompat
        : root.compat;

  return {
    grokVersion: str(root, "grokVersion"),
    channel: str(root, "channel"),
    cwd: str(root, "cwd"),
    projectRoot: str(root, "projectRoot"),
    projectTrusted: bool(root, "projectTrusted", false),
    instructions: mapRows(root.projectInstructions, normalizeInstruction),
    hooks: mapRows(root.hooks, normalizeHook),
    skills: mapRows(root.skills, normalizeSkill),
    agents: mapRows(root.agents, normalizeAgent),
    plugins: mapRows(root.plugins, normalizePlugin),
    marketplaces: mapRows(root.marketplaces, normalizeMarketplace),
    mcpServers: mapRows(root.mcpServers, normalizeInspectMcp),
    lspServers: mapRows(root.lspServers, normalizeLsp),
    configLayers: mapRows(layersRaw, normalizeLayer),
    warnings: mapRows(root.configWarnings, normalizeWarning),
    compat: mapRows(compatCells, normalizeCompatCell),
  };
}
