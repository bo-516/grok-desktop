/**
 * Public entry for the Environment inspect model.
 * Types, normalizeInspect, and MCP merge — re-exported for a stable import path.
 * Implementation lives in inspectModelTypes / inspectNormalize / mcpMerge.
 */

export type {
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
  McpHealth,
  McpRow,
  PluginRow,
  SkillRow,
  SourceKind,
} from "./inspectModelTypes.js";

export {
  maskSecret,
  normalizeInspect,
  normalizeSource,
} from "./inspectNormalize.js";

export {
  mergeMcpRows,
  mcpStatusKind,
  normalizeDoctorHealth,
  normalizeMcpList,
  sourceChipLabel,
} from "./mcpMerge.js";
