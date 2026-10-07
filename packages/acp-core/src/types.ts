/**
 * ACP protocol types used by the grok-desktop client.
 * Focused on the M0/M1 surface: handshake, prompt, updates, permission.
 *
 * Public entry only: declarations live in per-domain `types*.ts` modules and
 * are re-exported here, so `./types.js` imports and the package root stay
 * stable. Add new protocol types to the matching domain module, then list
 * them below.
 */

export type {
  InitializeResult,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  PromptResult,
} from "./typesJsonRpc.js";
export type {
  DiffContent,
  PermissionOptionId,
  PermissionRequest,
  ToolCallCard,
  ToolCallKind,
  ToolCallStatus,
} from "./typesToolCall.js";
export type {
  AgentContentOrigin,
  ContentBlock,
  TimelineItem,
  UserMessageOrigin,
} from "./typesTimeline.js";
export type {
  AvailableCommand,
  PlanEntry,
  SessionUpdate,
} from "./typesSessionUpdate.js";
export type {
  BackgroundTaskCard,
  GoalSnapshot,
  SubagentCard,
} from "./typesOrchestration.js";
export type {
  AgentMode,
  AvailableModel,
  AvailableReasoningEffort,
  SessionState,
  SessionStatus,
} from "./typesSession.js";

/** Re-export so consumers can import usage types from `types` or the package root. */
export type { SessionTokenUsage } from "./sessionTokenUsage.js";
