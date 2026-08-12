/**
 * Session lifecycle state transitions.
 * This module only handles immutable SessionState; it has no transport, React, or agent process I/O.
 */

import {
  abandonUnconfirmedSeedContent,
  finalizeLatestThought,
} from "./timeline.js";
import { nextTimelineId } from "./timelineId.js";
import {
  collapseRepeatedText,
} from "./userMessageChunk.js";
import { sanitizeUserEchoText } from "./userEchoText.js";
import type {
  ContentBlock,
  PermissionRequest,
  SessionState,
  SessionStatus,
} from "./types.js";

export { collapseRepeatedText } from "./userMessageChunk.js";

/**
 * Transition the session to an explicit status; a disconnected session may only resume streaming
 * after the reconnect path restores it first.
 * @param current Current session status.
 * @param next Desired status; unknown values are blocked by TypeScript.
 * @returns Next status suitable to write back onto SessionState.
 */
export function transitionStatus(
  current: SessionStatus,
  next: SessionStatus,
): SessionStatus {
  if (current === "disconnected" && next !== "disconnected" && next !== "idle") {
    if (next === "streaming" || next === "waiting_permission") {return next;}
  }
  return next;
}

/**
 * Optimistically append a user prompt and enter the streaming status.
 * Assigns `clientPromptId` + `origin: "local"` so later `user_message_chunk`
 * replay is identity-matched and never double-concatenates the body.
 * @param state Current session; not mutated in place.
 * @param blocks Validated ACP content blocks; an empty array still creates a user row — callers should block empty sends first.
 * @returns New session with a user row and streaming status.
 */
export function appendUserPrompt(
  state: SessionState,
  blocks: ContentBlock[],
): SessionState {
  const clientPromptId = nextTimelineId("prompt");
  // A new local turn must not stay stuck claiming unfinished session/load
  // seed agent/thought rows — abandon those latches, keep seed bodies.
  const baseTimeline = abandonUnconfirmedSeedContent(state.timeline);
  return {
    ...state,
    timeline: [
      ...baseTimeline,
      {
        kind: "user",
        id: nextTimelineId("user"),
        blocks,
        clientPromptId,
        origin: "local",
        agentConfirmed: false,
      },
    ],
    status: transitionStatus(state.status, "streaming"),
  };
}

/**
 * Tag cached transcript rows as seed so session/load replay can confirm them
 * without concatenating or double-appending.
 * - User rows: also heals bodies written by earlier builds — a prompt repeated
 *   once per replay, swallowed `<system-reminder>` log dumps, pure goal
 *   injections (collapsed to `Goal: …`), and multi-KB harness role packs
 *   (collapsed to role · objective) — then drops rows left with no content at
 *   all, so an old cache full of harness noise does not repaint it.
 * - Agent / thought rows: origin seed + agentConfirmed false so
 *   appendOrMergeText / appendOrMergeThought claim them in order.
 * Confirmed or already agent-origin rows are left alone (users still text-healed).
 * @param timeline Seed or disk-restored timeline; not mutated in place.
 * @returns Timeline where claimable rows carry origin seed and agentConfirmed
 *   false, minus user rows that healed down to nothing.
 */
export function tagSeedUserMessages(
  timeline: SessionState["timeline"],
): SessionState["timeline"] {
  const tagged = timeline.map((item) => {
    if (item.kind === "user") {
      let changed = false;
      const blocks = item.blocks.map((block) => {
        if (block.type !== "text") {
          return block;
        }
        const cleaned = sanitizeUserEchoText(
          collapseRepeatedText(block.text),
        );
        if (cleaned === block.text) {
          return block;
        }
        changed = true;
        return { type: "text" as const, text: cleaned };
      });
      if (item.origin === "agent" || item.agentConfirmed) {
        return changed ? { ...item, blocks } : item;
      }
      return {
        ...item,
        blocks,
        origin: item.origin ?? "seed",
        agentConfirmed: false,
        agentEchoAcc: item.agentEchoAcc,
      };
    }
    if (item.kind === "agent" || item.kind === "thought") {
      if (item.origin === "agent" || item.agentConfirmed) {
        return item;
      }
      return {
        ...item,
        origin: item.origin ?? "seed",
        agentConfirmed: false,
        agentEchoAcc: item.agentEchoAcc,
      };
    }
    return item;
  });
  return tagged.filter((item) => item.kind !== "user" || hasUserContent(item));
}

/**
 * Whether a user row still has anything worth painting after healing.
 * A row whose only text was a `<system-reminder>` dump heals to empty; keeping
 * it would render an empty bubble and, worse, offer itself as an absorb slot
 * for the next real echo.
 * @param item User timeline row.
 * @returns true when some text or non-text block survives.
 */
function hasUserContent(
  item: Extract<SessionState["timeline"][number], { kind: "user" }>,
): boolean {
  return item.blocks.some((block) =>
    block.type === "text" ? block.text.trim().length > 0 : true,
  );
}

/**
 * Mark a prompt turn as started and clear the previous turn's accumulated body text.
 * @param state Current session.
 * @returns New session in streaming status without stale error text.
 */
export function markPromptStarted(state: SessionState): SessionState {
  return {
    ...state,
    timeline: abandonUnconfirmedSeedContent(state.timeline),
    status: transitionStatus(state.status, "streaming"),
    errorMessage: undefined,
    lastAgentText: "",
  };
}

/**
 * Settle the session after the prompt response and quiet window complete.
 * @param state Current session; left unchanged when waiting for permission or already disconnected so higher-priority statuses are not overwritten.
 * @param opts Reserved cancel flag; kept only for API compatibility and does not change the result today.
 * @returns Idle session with the trailing Thinking closed, or the original session when it cannot settle.
 */
export function markPromptSettled(
  state: SessionState,
  opts?: { cancelled?: boolean },
): SessionState {
  const settledTimeline = finalizeLatestThought(state.timeline);
  void opts;

  if (state.status === "waiting_permission" || state.status === "disconnected") {
    return state;
  }
  return { ...state, timeline: settledTimeline, status: "idle" };
}

/**
 * Enter the waiting-for-permission status.
 * @param state Current session.
 * @param request Permission request already shaped from protocol params; missing options still allow the UI to show a default deny path.
 * @returns New session with pendingPermission set.
 */
export function setPendingPermission(
  state: SessionState,
  request: PermissionRequest,
): SessionState {
  return { ...state, pendingPermission: request, status: "waiting_permission" };
}

/**
 * Clear pending permission and restore the given status.
 * @param state Current session.
 * @param nextStatus Status after the user chooses; defaults to continue streaming.
 * @returns New session without pendingPermission.
 */
export function clearPendingPermission(
  state: SessionState,
  nextStatus: SessionStatus = "streaming",
): SessionState {
  return { ...state, pendingPermission: undefined, status: nextStatus };
}

/**
 * Normalize an agent permission request into the model the UI needs.
 * @param requestId JSON-RPC request id; missing it prevents a reply, so the caller must supply it.
 * @param params Raw agent params; safe default options are provided when fields are missing.
 * @returns Structure suitable for the permission dialog, with raw retained for diagnostics.
 */
export function shapePermissionRequest(
  requestId: number | string,
  params: unknown,
): PermissionRequest {
  const source = (params ?? {}) as Record<string, unknown>;
  const toolCall = (source.toolCall ?? source.tool_call ?? {}) as Record<
    string,
    unknown
  >;
  const rawOptions = (source.options ?? source.permissionOptions ?? []) as Array<
    Record<string, unknown>
  >;
  const options =
    rawOptions.length > 0
      ? rawOptions.map((option) => ({
          optionId: String(option.optionId ?? option.id ?? "allow_once"),
          name: typeof option.name === "string" ? option.name : undefined,
          kind: typeof option.kind === "string" ? option.kind : undefined,
        }))
      : [
          { optionId: "allow_once", name: "Allow once" },
          { optionId: "allow_always", name: "Always allow this tool" },
          { optionId: "deny", name: "Deny" },
          { optionId: "deny_and_stop", name: "Deny and stop" },
        ];

  /** toolCallId: prefer the standard field, fall back to id. */
  let toolCallId: string | undefined;
  if (typeof toolCall.toolCallId === "string") {
    toolCallId = toolCall.toolCallId;
  } else if (typeof toolCall.id === "string") {
    toolCallId = toolCall.id;
  }

  return {
    requestId,
    sessionId: typeof source.sessionId === "string" ? source.sessionId : undefined,
    toolCall: {
      toolCallId,
      title: typeof toolCall.title === "string" ? toolCall.title : undefined,
      kind: typeof toolCall.kind === "string" ? toolCall.kind : undefined,
      status: typeof toolCall.status === "string" ? toolCall.status : undefined,
    },
    options,
    raw: params,
  };
}

/**
 * Build the success response body for an ACP permission request.
 * @param optionId Option id chosen by the user; a wrong value is rejected by the agent or returns a protocol error.
 * @returns Object that can be used directly as a JSON-RPC result.
 */
export function buildPermissionOutcome(optionId: string): unknown {
  return { outcome: { outcome: "selected", optionId } };
}

/**
 * Mark the transport as disconnected and close any Thought still streaming in the UI.
 * @param state Current session.
 * @returns New session no longer waiting for permission, with status disconnected.
 */
export function markDisconnected(state: SessionState): SessionState {
  return {
    ...state,
    timeline: finalizeLatestThought(state.timeline),
    status: "disconnected",
    pendingPermission: undefined,
  };
}
