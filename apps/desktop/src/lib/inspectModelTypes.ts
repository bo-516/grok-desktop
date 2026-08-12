/**
 * Typed inspect / MCP domain model for the Environment sheet.
 * Pure types only — normalization lives in inspectNormalize / mcpMerge.
 */

/** Where an item came from. `plugin` also carries the owning plugin name. */
export type SourceKind =
  | "bundled"
  | "user"
  | "project"
  | "plugin"
  | "builtin"
  | "marketplace"
  | "unknown";

/** Provenance for one inspect-listed item. */
export type ItemSource = {
  /** Source kind after normalization. */
  kind: SourceKind;
  /** Absolute path to the defining file / directory when the CLI reports one. */
  path?: string;
  /** Owning plugin for kind === "plugin". */
  pluginName?: string;
};

/** One skill from `inspect.skills`. */
export type SkillRow = {
  name: string;
  description: string;
  source: ItemSource;
  /** True when the skill is reachable as `/<name>` from the composer. */
  userInvocable: boolean;
};

/** Per-server health from `mcp doctor` (or cached). */
export type McpHealth = {
  /** Aggregate healthy flag from doctor when present. */
  healthy: boolean;
  /** Human-readable summary (check counts or error). */
  summary: string;
  /** Individual doctor checks when available. */
  checks: Array<{ label: string; passed: boolean; detail: string }>;
};

/** One MCP server after inspect ⊕ list ⊕ doctor merge. */
export type McpRow = {
  name: string;
  transport: "stdio" | "http" | "sse" | "unknown";
  /** Command line (stdio) or URL (http/sse), already secret-masked. */
  target: string;
  source: ItemSource;
  /**
   * From `mcp list` when the server is config-defined; undefined for plugin-only
   * servers that never appear in config.
   */
  enabled?: boolean;
  /**
   * True when the server exists only in config (list) and not in inspect —
   * typically disabled or inactive.
   */
  inactive?: boolean;
  /** From doctor; undefined until a doctor run covers this server. */
  health?: McpHealth;
  /** Config scope when known from list. */
  scope?: "user" | "project" | "unknown";
  /** Env keys only (values masked) when config list provides them. */
  envKeys?: string[];
  /** Header names only when config list provides them. */
  headerNames?: string[];
};

/** One plugin from inspect. */
export type PluginRow = {
  name: string;
  version?: string;
  scope: "user" | "project" | "unknown";
  enabled: boolean;
  path?: string;
  marketplace?: string;
  provides: {
    skills: number;
    agents: number;
    hooks: boolean;
    mcpServers: number;
  };
};

/** One agent definition from inspect. */
export type AgentRow = {
  name: string;
  description: string;
  source: ItemSource;
};

/** One marketplace from inspect. */
export type MarketplaceRow = {
  name: string;
  url?: string;
  source?: ItemSource;
};

/** One hook registration from inspect. */
export type HookRow = {
  event: string;
  matcher?: string;
  command?: string;
  source: ItemSource;
};

/** One project instruction / rule file. */
export type InstructionRow = {
  path: string;
  scope: string;
  fileType: string;
  approxTokens?: number;
  sizeBytes?: number;
};

/** One config layer from configSources.layers. */
export type ConfigLayer = {
  role: string;
  path: string;
};

/** One config warning. */
export type ConfigWarning = {
  target: string;
  path: string;
  kind: string;
  reason: string;
};

/** One external-compat matrix cell. */
export type CompatCell = {
  vendor: string;
  surface: string;
  enabled: boolean;
  source: string;
};

/** One LSP server entry (phase 1 keeps shape only). */
export type LspRow = {
  name: string;
  source: ItemSource;
};

/**
 * Fully normalized `grok inspect --json` snapshot.
 * Arrays are always arrays; missing CLI fields become empty lists.
 */
export type InspectSnapshot = {
  grokVersion: string;
  channel: string;
  cwd: string;
  projectRoot: string;
  projectTrusted: boolean;
  instructions: InstructionRow[];
  hooks: HookRow[];
  skills: SkillRow[];
  agents: AgentRow[];
  plugins: PluginRow[];
  marketplaces: MarketplaceRow[];
  mcpServers: McpRow[];
  lspServers: LspRow[];
  configLayers: ConfigLayer[];
  warnings: ConfigWarning[];
  compat: CompatCell[];
  /** Set when the CLI could not produce JSON and the bridge fell back to text. */
  rawFallback?: string;
};
