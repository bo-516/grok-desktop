/**
 * Single-session snapshot consumed by the UI (`SessionState`) plus the
 * status / mode / model-catalog types it is built from. Aggregates the
 * timeline, tool-call, update and orchestration domains into one record.
 */

import type { SessionTokenUsage } from "./sessionTokenUsage.js";
import type {
  BackgroundTaskCard,
  GoalSnapshot,
  SubagentCard,
} from "./typesOrchestration.js";
import type { AvailableCommand, PlanEntry } from "./typesSessionUpdate.js";
import type { TimelineItem } from "./typesTimeline.js";
import type { PermissionRequest, ToolCallCard } from "./typesToolCall.js";

/** Session runtime status shown in the UI chrome. */
export type SessionStatus =
  | "idle"
  | "streaming"
  | "waiting_permission"
  | "disconnected";

/** UI permission mode mapped to sandbox profiles (product layer). */
export type AgentMode = "ask" | "plan" | "build";

/** One row in a model's advertised reasoning-effort menu. */
export type AvailableReasoningEffort = {
  /** Wire id sent as `--reasoning-effort` / `/effort` (e.g. `xhigh`). */
  id: string;
  /** Human label when the agent supplied one (`Extra High Effort`). */
  label?: string;
  /** True when this row is a model/catalog default. */
  default?: boolean;
};

/** One model the agent advertises for session/set_model and the model picker. */
export type AvailableModel = {
  /** Stable model id passed to session/set_model. */
  id: string;
  /** Optional human label from the agent; UI may fall back to formatting the id. */
  name?: string;
  /**
   * Context window size from model `_meta.totalContextTokens` (grok-build).
   * Used for the composer context ring; omitted when the agent did not declare it.
   */
  totalContextTokens?: number;
  /**
   * Reasoning-effort ladder from `_meta.reasoning_efforts` (grok-build / models
   * cache). Composer Thinking menu uses this when config_option_update is empty.
   * Omitted when the agent did not declare a per-model menu.
   */
  reasoningEfforts?: AvailableReasoningEffort[];
  /**
   * Agent's current effort (`_meta.reasoningEffort`), distinct from the ladder
   * row marked `default` (the recommended level). Omitted when the agent did
   * not report one — do not invent a selection.
   */
  reasoningEffort?: string;
};

/** Full single-session state consumed by the UI. */
export type SessionState = {
  id: string;
  workspace: string;
  model: string;
  mode: AgentMode;
  status: SessionStatus;
  timeline: TimelineItem[];
  /** toolCallId → card; used for in-place patch updates. */
  toolCalls: Record<string, ToolCallCard>;
  plan?: PlanEntry[];
  pendingPermission?: PermissionRequest;
  /** Snapshot of commands the current agent can run, used for `/` autocomplete in the input box. */
  availableCommands?: AvailableCommand[];
  /**
   * Agent-declared model catalog from initialize / session models.
   * UI model picker must use this (plus live `config_option_update`), never a hardcoded product list.
   */
  availableModels?: AvailableModel[];
  /**
   * Agent-provided display title from `session_info_update`.
   * Prefer this over id-based placeholders when non-empty.
   */
  title?: string;
  /** Last activity time provided by the agent; invalid values do not overwrite existing data. */
  updatedAt?: string;
  /** Last known agent config options from `config_option_update`. */
  configOptions?: unknown[];
  /**
   * Agent todos (F-CTX-06) — distinct from plan entries.
   * Populated when session/update carries todos or a todos field on plan-like payloads.
   */
  todos?: Array<{
    id?: string;
    content?: string;
    title?: string;
    status?: string;
  }>;
  /**
   * From initialize `agentCapabilities` (e.g. promptCapabilities.image).
   * UI must consult this before sending image ContentBlocks (F-STREAM-07).
   */
  agentCapabilities?: unknown;
  /** Accumulated agent text for M0 logging convenience. */
  lastAgentText: string;
  errorMessage?: string;
  /**
   * Latest token usage (F-CTX-01): billed last-turn counters plus live
   * `contextTokensUsed` occupancy from mid-turn `_meta.totalTokens`.
   * Occupancy refreshes as tools / model calls land; billed fields overwrite
   * on `turn_completed` without dropping occupancy. Silent metadata.
   */
  tokenUsage?: SessionTokenUsage;
  /** Goal-mode snapshot; absent when the agent is not running an orchestrated goal. */
  goal?: GoalSnapshot;
  /** subagentId → card; sidebar data, never timeline rows. */
  subagents?: Record<string, SubagentCard>;
  /** taskId → card; session-scoped background shell tasks. */
  backgroundTasks?: Record<string, BackgroundTaskCard>;
  /**
   * subagentId → toolCallId of the `spawn_subagent` card that created it.
   * Protocol-derived join key so timeline groups and orchestration cards
   * link without title matching. Written from either arrival order.
   */
  subagentLinks?: Record<string, string>;
};
