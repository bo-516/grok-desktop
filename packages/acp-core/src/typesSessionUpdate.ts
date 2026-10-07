/**
 * `session/update` payload union plus the plan / slash-command entries it
 * carries. Reducers switch on `sessionUpdate`; the trailing open arm keeps
 * vendor kinds (goal / subagent / task) flowing without a type change.
 */

import type { ToolCallKind, ToolCallStatus } from "./typesToolCall.js";

/**
 * One row of the agent's plan (`plan` update). Agents fill either `content`
 * or `title`; `status` / `priority` are agent-defined strings kept verbatim.
 */
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
