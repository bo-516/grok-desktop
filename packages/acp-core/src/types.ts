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

/** Prompt content block (subset of ACP ContentBlock). */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "resource_link"; uri: string; name?: string }
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
  /** Arbitrary extra fields from the agent (preserved on patch). */
  meta?: Record<string, unknown>;
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
  | { kind: "agent"; id: string; text: string }
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
      content?: { type?: string; text?: string };
    }
  | {
      sessionUpdate: "agent_message_chunk";
      content?: { type?: string; text?: string };
    }
  | {
      sessionUpdate: "agent_thought_chunk";
      content?: { type?: string; text?: string };
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
};

/** One model the agent advertises for session/set_model and the model picker. */
export type AvailableModel = {
  /** Stable model id passed to session/set_model. */
  id: string;
  /** Optional human label from the agent; UI may fall back to formatting the id. */
  name?: string;
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
