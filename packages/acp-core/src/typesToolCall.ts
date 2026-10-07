/**
 * Tool-call cards and permission requests: the entities a turn creates
 * besides text. Cards are patch-merged by toolCallId; permission requests
 * are the agent's reverse `session/request_permission` calls.
 */

/** Diff payload on edit tool cards. */
export type DiffContent = {
  type: "diff";
  path: string;
  oldText?: string;
  newText?: string;
};

/**
 * Tool lifecycle status. Known ACP values are listed for autocomplete; the
 * `string` arm keeps unknown agent values instead of dropping the update.
 */
export type ToolCallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | string;

/**
 * Tool category hint used for icons / grouping. Open-ended like
 * ToolCallStatus: unknown kinds render with the generic chrome.
 */
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

/**
 * Permission choice id echoed back in the outcome. Known ids are listed;
 * the `string` arm accepts agent-specific options verbatim.
 */
export type PermissionOptionId =
  | "allow_once"
  | "allow_always"
  | "deny"
  | "deny_and_stop"
  | string;

/**
 * Pending `session/request_permission` shaped for the UI.
 * `requestId` is the JSON-RPC id the reply must carry; a wrong id leaves the
 * agent waiting forever. Optional fields are absent when the agent omits them.
 */
export type PermissionRequest = {
  requestId: number | string;
  sessionId?: string;
  toolCall?: Partial<ToolCallCard> & { toolCallId?: string };
  options?: Array<{ optionId: PermissionOptionId; name?: string; kind?: string }>;
  /** Original params for debugging / passthrough. */
  raw?: unknown;
};
