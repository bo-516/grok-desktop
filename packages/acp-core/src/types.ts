/**
 * ACP protocol types used by the grok-desktop client.
 * Focused on the M0/M1 surface: handshake, prompt, updates, permission.
 */

/** JSON-RPC 2.0 request (client→agent or agent→client). */
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
};

/** JSON-RPC 2.0 success/error response. */
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

/** JSON-RPC 2.0 notification (no id). */
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

/** Session runtime status shown in the UI chrome. */
export type SessionStatus =
  | "idle"
  | "streaming"
  | "waiting_permission"
  | "disconnected";

/** UI permission mode mapped to sandbox profiles (product layer). */
export type AgentMode = "ask" | "plan" | "build";

/**
 * Prompt content block (subset of ACP ContentBlock).
 *
 * Embedded `resource` matches MCP EmbeddedResource shape confirmed by live
 * `grok agent stdio` probe (type:"resource" + nested resource.uri/text/mimeType).
 * Flat fields without the `resource` wrapper are rejected by the agent.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name?: string }
  | {
      type: "resource";
      resource: {
        /** file:// URI of the attached path (workspace-relative origin). */
        uri: string;
        /** Snapshot of file body at send time (UTF-8 text only). */
        text: string;
        mimeType?: string;
      };
    }
  | { type: "image"; mimeType: string; data: string };

/** Diff payload on edit tool cards. */
export type DiffContent = {
  type: "diff";
  path: string;
  oldText?: string;
  newText?: string;
};

export type ToolCallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | string;

export type ToolCallKind =
  | "read"
  | "edit"
  | "execute"
  | "search"
  | "think"
  | "fetch"
  | string;

/**
 * Tool card entity stored in a Map keyed by toolCallId.
 * Updates must patch-merge; status-only updates must not wipe content.
 */
export type ToolCallCard = {
  toolCallId: string;
  title?: string;
  kind?: ToolCallKind;
  status?: ToolCallStatus;
  content?: unknown;
  rawLocations?: unknown;
  /**
   * Vendor `_meta` from the raw update (e.g. `x.ai/tool`), merged on patch.
   * Identifies tools the UI must render specially (subagent spawn / wait /
   * kill) without matching on human-facing titles.
   */
  meta?: Record<string, unknown>;
  /**
   * Agent-supplied tool input (`rawInput`). Only UI-needed keys are retained
   * by the reducer (`description` / `task_ids`); never render wholesale.
   * Missing or omitted when the update carries no usable input fields.
   */
  rawInput?: Record<string, unknown>;
};

export type PlanEntry = {
  content?: string;
  title?: string;
  status?: "pending" | "in_progress" | "completed" | string;
  priority?: string;
};

/**
 * Slash command or skill announced by the agent.
 * `name` does not include `/`; `input` is only for hinting optional parameters to the user and is not validated by the protocol.
 * Missing or invalid fields are dropped during normalization so corrupted agent metadata is not rendered in the input box.
 */
export type AvailableCommand = {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
  _meta?: Record<string, unknown>;
};

export type PermissionOptionId =
  | "allow_once"
  | "allow_always"
  | "deny"
  | "deny_and_stop"
  | string;

export type PermissionRequest = {
  requestId: number | string;
  sessionId?: string;
  toolCall?: Partial<ToolCallCard> & { toolCallId?: string };
  options?: Array<{ optionId: PermissionOptionId; name?: string; kind?: string }>;
  /** Original params for debugging / passthrough. */
  raw?: unknown;
};

/**
 * Provenance of a user timeline row.
 * - `local`: optimistic `appendUserPrompt` (has `clientPromptId`)
 * - `seed`: restored from cached transcript before agent replay
 * - `agent`: created only from `user_message_chunk` with no pending local/seed row
 */
export type UserMessageOrigin = "local" | "seed" | "agent";

/**
 * Provenance of agent / thought timeline rows (seed vs live).
 * - `seed`: restored from cached transcript before session/load replay
 * - `agent`: created from live or post-claim streaming chunks
 */
export type AgentContentOrigin = "seed" | "agent";

export type TimelineItem =
  | {
      kind: "user";
      id: string;
      blocks: ContentBlock[];
      /**
       * Client-assigned prompt identity for optimistic rows.
       * Agent replay matches unconfirmed rows by order + this id, not string equality alone.
       */
      clientPromptId?: string;
      /** How this row was first created; missing is treated as seed-compatible for resume. */
      origin?: UserMessageOrigin;
      /**
       * True once agent has fully echoed this prompt (live or session/load replay).
       * Further matching `user_message_chunk` events for this slot are discarded.
       */
      agentConfirmed?: boolean;
      /**
       * Accumulated agent-echo text while chunked replay of this row is in progress.
       * Used only for progress/confirm; authoritative body stays in `blocks` for local/seed.
       */
      agentEchoAcc?: string;
    }
  | {
      kind: "agent";
      id: string;
      text: string;
      /** How this row was first created; seed rows are claimed on session/load replay. */
      origin?: AgentContentOrigin;
      /**
       * True once session/load (or live) has fully echoed this seed agent body.
       * Further matching chunks for this slot are discarded instead of double-appending.
       */
      agentConfirmed?: boolean;
      /** Accumulated replay echo while claiming a seed agent row. */
      agentEchoAcc?: string;
    }
  | {
      /** Expandable reasoning fragment; body text is never mixed into agent messages. */
      kind: "thought";
      id: string;
      text: string;
      /** First render should be collapsed; the UI may toggle expand state locally. */
      collapsed: boolean;
      /** Local timestamp when the first thought chunk arrived; if missing, UI shows only Thought. */
      startedAt: number;
      /** Written when the next non-thought event arrives or the turn ends; used to display duration. */
      completedAt?: number;
      /** How this row was first created; seed rows are claimed on session/load replay. */
      origin?: AgentContentOrigin;
      /**
       * True once session/load has fully echoed this seed thought body.
       * Prevents pure-append duplication on resume.
       */
      agentConfirmed?: boolean;
      /** Accumulated replay echo while claiming a seed thought row. */
      agentEchoAcc?: string;
    }
  | { kind: "tool"; id: string; toolCallId: string }
  | { kind: "error"; id: string; message: string };

/**
 * Discriminated session/update payload (params.update).
 * sessionUpdate is the discriminant field per ACP / todo.md.
 */
export type SessionUpdate =
  | {
      sessionUpdate: "user_message_chunk";
      /**
       * Text echo (`type: "text"`) or binary image (`type: "image"` + mimeType/data).
       * grok-build sends images as separate chunks after the text echo that carries
       * `[Image #N]` placeholders — both must land on the same user row.
       */
      content?: {
        type?: string;
        text?: string;
        mimeType?: string;
        data?: string;
        uri?: string;
        _meta?: Record<string, unknown>;
      };
    }
  | {
      sessionUpdate: "agent_message_chunk";
      content?: { type?: string; text?: string };
      /** Stamped envelope occupancy / eventId after extractSessionUpdate. */
      _meta?: Record<string, unknown>;
    }
  | {
      sessionUpdate: "agent_thought_chunk";
      content?: { type?: string; text?: string };
      /** Stamped envelope occupancy / eventId after extractSessionUpdate. */
      _meta?: Record<string, unknown>;
    }
  | {
      sessionUpdate: "tool_call";
      toolCallId: string;
      title?: string;
      kind?: ToolCallKind;
      status?: ToolCallStatus;
      content?: unknown;
      locations?: unknown;
      [key: string]: unknown;
    }
  | {
      sessionUpdate: "tool_call_update";
      toolCallId: string;
      title?: string;
      kind?: ToolCallKind;
      status?: ToolCallStatus;
      content?: unknown;
      locations?: unknown;
      [key: string]: unknown;
    }
  | {
      sessionUpdate: "plan";
      entries?: PlanEntry[];
      [key: string]: unknown;
    }
  | {
      sessionUpdate: "available_commands_update";
      availableCommands?: AvailableCommand[];
      [key: string]: unknown;
    }
  | {
      sessionUpdate: "current_mode_update";
      mode?: string;
      currentModeId?: string;
      [key: string]: unknown;
    }
  | {
      /** Agent-pushed session metadata (title / activity time). ACP RFD. */
      sessionUpdate: "session_info_update";
      /** Human-readable title; null clears. Omitted → leave unchanged. */
      title?: string | null;
      /** ISO 8601 last-activity timestamp; null clears. */
      updatedAt?: string | null;
      _meta?: Record<string, unknown> | null;
      [key: string]: unknown;
    }
  | {
      /** Full config options snapshot from agent (model / effort / etc.). */
      sessionUpdate: "config_option_update";
      configOptions?: unknown[];
      [key: string]: unknown;
    }
  | {
      sessionUpdate: string;
      [key: string]: unknown;
    };

/**
 * Orchestration goal snapshot from `goal_updated`; absent outside goal mode.
 * Counters default to 0 when a goal exists (agent always reports them).
 */
export type GoalSnapshot = {
  /** Stable goal id from the orchestrator. */
  goalId: string;
  /** User objective verbatim; drives the goal header. */
  objective: string;
  /** active | complete | … — agent-defined, kept as string on purpose. */
  status: string;
  /** executing | idle | … — the orchestrator's current stage. */
  phase: string;
  totalDeliverables: number;
  completedDeliverables: number;
  workerRounds: number;
  verifyRounds: number;
  tokensUsed: number;
  /** Last state-machine transition name (e.g. `goal_created`). */
  lastEvent?: string;
  lastEventAt?: string;
  /**
   * Prose from `last_event_detail` (worker FINAL_RESPONSE / completion note).
   * Goal mode often never emits a trailing `agent_message_chunk`; this is the
   * only user-facing wrap-up on the wire. Later `goal_updated` frames that
   * omit the field must not wipe a previously captured value.
   */
  lastEventDetail?: string;
};

/**
 * One subagent the orchestrator spawned.
 * A completed `spawn_subagent` tool may create the card first; `subagent_spawned`
 * / `subagent_finished` then patch it in place — same lifecycle as `toolCalls`,
 * so out-of-order or replayed events converge on one row.
 * Unreported counters stay `undefined` (not `0`) so the UI can hide missing data.
 */
export type SubagentCard = {
  subagentId: string;
  /** Drill-down target: a real session id loadable via `session/load`. */
  childSessionId: string;
  /** Parent turn that spawned it; groups fan-out by round. */
  parentPromptId?: string;
  /** general-purpose | explore | plan */
  type: string;
  /** Agent-written role label, e.g. "goal achievement skeptic". */
  description: string;
  model?: string;
  /** running until `subagent_finished` reports completed / failed. */
  status: string;
  toolCalls?: number;
  turns?: number;
  durationMs?: number;
  tokensUsed?: number;
  output?: string;
  /**
   * Spawn tool card that created this subagent; resolved from `subagentLinks`.
   * Order-independent: may arrive via spawn-card completion first or via
   * `subagent_spawned` reading an earlier link write.
   */
  toolCallId?: string;
};

/**
 * One backgrounded shell task from `task_backgrounded` / `task_completed`.
 * Unreported optional fields stay undefined rather than collapsing to empty.
 */
export type BackgroundTaskCard = {
  taskId: string;
  /** Tool call that spawned it; links the card back to its timeline row. */
  toolCallId?: string;
  command: string;
  cwd?: string;
  /**
   * Absolute log path under `<session>/terminal/` (outside the project
   * workspace). Preview must sandbox the read to that directory.
   */
  outputFile?: string;
  description?: string;
  status: string;
};

/** Re-export so consumers can import usage types from `types` or the package root. */
export type { SessionTokenUsage } from "./sessionTokenUsage.js";
import type { SessionTokenUsage } from "./sessionTokenUsage.js";

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
};

export type InitializeResult = {
  protocolVersion?: number | string;
  agentCapabilities?: unknown;
  authMethods?: Array<{ id: string; name?: string }>;
  availableModels?: Array<{ id: string; name?: string }>;
  [key: string]: unknown;
};

export type PromptResult = {
  stopReason?: string;
  [key: string]: unknown;
};
