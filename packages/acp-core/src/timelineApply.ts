/**
 * Apply one ACP session/update to SessionState (pure reducer).
 * Delegates text merge / tool patch to sibling modules.
 */

import type {
  PlanEntry,
  SessionState,
  SessionUpdate,
  ToolCallCard,
} from "./types.js";
import { normalizeAvailableCommands } from "./sessionMetadata.js";
import { nextTimelineId } from "./timelineId.js";
import { applyUserMessageChunk } from "./userMessageChunk.js";
import {
  isHiddenFromScrollback,
  stripSystemReminders,
} from "./userEchoText.js";
import { patchToolCard } from "./timelineToolCard.js";
import {
  appendOrMergeText,
  appendOrMergeThought,
  finalizeLatestThought,
} from "./timelineTextMerge.js";

/**
 * Session-update kinds that insert a visible timeline row (or update one).
 * Only these (plus hard error rows in `default`) may finalize an open thought.
 * Silent metadata (plan / todos / mode / usage / …) must not split continuous reasoning.
 */
const VISIBLE_UPDATE_KINDS = new Set([
  "agent_message_chunk",
  "user_message_chunk",
  "tool_call",
  "tool_call_update",
]);

/**
 * Close open Thinking only when the update will produce a visible timeline change.
 * Silent metadata kinds leave the current thought open so continuous reasoning stays one row.
 * @param state Current session snapshot.
 * @param kind Discriminant of the incoming sessionUpdate.
 * @returns State with trailing incomplete thought finalized, or the original state.
 */
function withFinalizedThoughtIfVisible(
  state: SessionState,
  kind: string,
): SessionState {
  if (!VISIBLE_UPDATE_KINDS.has(kind)) {
    return state;
  }
  return {
    ...state,
    timeline: finalizeLatestThought(state.timeline),
  };
}

/**
 * Read text payload from chunk-style session updates without tight unions.
 * Agents may send slightly different content shapes; missing text → empty.
 * @param update Raw session update carrying optional content.text.
 * @returns Text string or empty when missing.
 */
function chunkText(update: SessionUpdate): string {
  const content = (update as { content?: { text?: unknown } }).content;
  if (!content || typeof content !== "object") {
    return "";
  }
  return typeof content.text === "string" ? content.text : "";
}

/**
 * Text of a user echo chunk that is allowed onto the canvas.
 *
 * grok-build reuses `user_message_chunk` for harness injections (background
 * task completions, hook notices): the agent flags them `hideFromScrollback`
 * and wraps them in `<system-reminder>`. They are not something the person
 * said, so they must not open a bubble, extend one, or finalize a thought —
 * returning empty makes the caller drop the update whole.
 * @param update Raw user_message_chunk update.
 * @returns Displayable user text, or empty when the chunk is harness-only.
 */
function visibleUserChunkText(update: SessionUpdate): string {
  if (isHiddenFromScrollback(update)) {
    return "";
  }
  return stripSystemReminders(chunkText(update));
}

/**
 * Map agent mode ids onto product chips (ask/plan/build).
 * Accepts common aliases from current_mode_update / permission-mode.
 * @param raw Agent mode string.
 * @returns Product mode or null when unrecognized.
 */
function normalizeMode(raw: string): SessionState["mode"] | null {
  const m = raw.toLowerCase().replace(/[_-]/g, "");
  if (m === "ask" || m === "default" || m === "defaultask") {
    return "ask";
  }
  if (m === "plan") {
    return "plan";
  }
  if (
    m === "build" ||
    m === "auto" ||
    m === "acceptedits" ||
    m === "bypasspermissions" ||
    m === "yolo" ||
    m === "alwaysapprove"
  ) {
    return "build";
  }
  return null;
}

/**
 * Immutably apply one ACP `session/update`.
 * Visible kinds (message / tool) end active Thinking; silent metadata does not.
 * @param state Current session snapshot; not mutated in place.
 * @param update Event already extracted by extractSessionUpdate; unknown types are kept as soft error rows for diagnostics.
 * @returns New session state shared by UI, bridge, and tests.
 */
export function applySessionUpdate(
  state: SessionState,
  update: SessionUpdate,
): SessionState {
  const kind = update.sessionUpdate;

  switch (kind) {
    case "user_message_chunk": {
      const text = visibleUserChunkText(update);
      if (!text) {
        return state;
      }
      const base = withFinalizedThoughtIfVisible(state, kind);
      const timeline = applyUserMessageChunk(base.timeline, text);
      return { ...base, timeline };
    }
    case "agent_message_chunk": {
      const text = chunkText(update);
      if (!text) {
        return state;
      }
      const base = withFinalizedThoughtIfVisible(state, kind);
      const timeline = appendOrMergeText(base.timeline, "agent", text);
      return {
        ...base,
        timeline,
        lastAgentText: base.lastAgentText + text,
        status:
          base.status === "waiting_permission" ? base.status : "streaming",
      };
    }
    case "agent_thought_chunk": {
      const text = chunkText(update);
      if (!text) {
        return state;
      }
      const timeline = appendOrMergeThought(state.timeline, text);
      return { ...state, timeline };
    }
    case "tool_call": {
      const base = withFinalizedThoughtIfVisible(state, kind);
      const toolCallId = String(
        (update as { toolCallId?: string }).toolCallId ?? "",
      );
      if (!toolCallId) {
        return state;
      }
      const card = patchToolCard(base.toolCalls[toolCallId], {
        toolCallId,
        title: update.title as string | undefined,
        kind: update.kind as string | undefined,
        status: (update.status as string | undefined) ?? "pending",
        content: update.content,
        rawLocations: (update as { locations?: unknown }).locations,
      });
      const toolCalls = {
        ...base.toolCalls,
        [toolCallId]: card,
      };
      const already = base.timeline.some(
        (t) => t.kind === "tool" && t.toolCallId === toolCallId,
      );
      const timeline = already
        ? base.timeline
        : [
            ...base.timeline,
            {
              kind: "tool" as const,
              id: nextTimelineId("tool"),
              toolCallId,
            },
          ];
      return { ...base, toolCalls, timeline };
    }
    case "tool_call_update": {
      const base = withFinalizedThoughtIfVisible(state, kind);
      const toolCallId = String(
        (update as { toolCallId?: string }).toolCallId ?? "",
      );
      if (!toolCallId) {
        return state;
      }
      const existing = base.toolCalls[toolCallId];
      const patch: Partial<ToolCallCard> & { toolCallId: string } = {
        toolCallId,
      };
      if (update.title !== undefined) {
        patch.title = update.title as string;
      }
      if (update.kind !== undefined) {
        patch.kind = update.kind as string;
      }
      if (update.status !== undefined) {
        patch.status = update.status as string;
      }
      // Only set content when the update actually carries it — status-only must not wipe
      if (Object.prototype.hasOwnProperty.call(update, "content")) {
        patch.content = update.content;
      }
      if (Object.prototype.hasOwnProperty.call(update, "locations")) {
        patch.rawLocations = (update as { locations?: unknown }).locations;
      }
      const card = patchToolCard(existing, patch);
      const toolCalls = {
        ...base.toolCalls,
        [toolCallId]: card,
      };
      // If we never saw tool_call, still insert a timeline pointer
      const already = base.timeline.some(
        (t) => t.kind === "tool" && t.toolCallId === toolCallId,
      );
      const timeline = already
        ? base.timeline
        : [
            ...base.timeline,
            {
              kind: "tool" as const,
              id: nextTimelineId("tool"),
              toolCallId,
            },
          ];
      return { ...base, toolCalls, timeline };
    }
    case "plan": {
      // Silent metadata — do not finalize thought.
      const entries = (update.entries ??
        (update as { plan?: PlanEntry[] }).plan ??
        []) as PlanEntry[];
      return { ...state, plan: entries };
    }
    case "available_commands_update": {
      return {
        ...state,
        availableCommands: normalizeAvailableCommands(
          (update as { availableCommands?: unknown }).availableCommands,
        ),
      };
    }
    case "current_mode_update": {
      const modeRaw =
        (update as { mode?: string }).mode ??
        (update as { currentModeId?: string }).currentModeId ??
        "";
      const mode = normalizeMode(modeRaw);
      return mode ? { ...state, mode } : state;
    }
    case "session_info_update": {
      // Real grok-build session title updates only touch metadata and must never enter the error timeline.
      const next: SessionState = { ...state };
      if (Object.prototype.hasOwnProperty.call(update, "title")) {
        const titleRaw = (update as { title?: string | null }).title;
        if (titleRaw === null) {
          delete next.title;
        } else if (typeof titleRaw === "string") {
          const trimmed = titleRaw.trim();
          if (trimmed) {
            next.title = trimmed;
          } else {
            delete next.title;
          }
        }
      }
      if (Object.prototype.hasOwnProperty.call(update, "updatedAt")) {
        const updatedAtRaw = (update as { updatedAt?: string | null })
          .updatedAt;
        if (updatedAtRaw === null) {
          delete next.updatedAt;
        } else if (typeof updatedAtRaw === "string" && updatedAtRaw.trim()) {
          next.updatedAt = updatedAtRaw.trim();
        }
      }
      return next;
    }
    case "config_option_update": {
      // Store snapshot for chrome (model picker etc.); no timeline row.
      const configOptions = (update as { configOptions?: unknown[] })
        .configOptions;
      if (!Array.isArray(configOptions)) {
        return state;
      }
      return { ...state, configOptions };
    }
    case "todos":
    case "todo_update":
    case "todos_update": {
      // F-CTX-06: todos are distinct from plan; accept several agent kind names.
      const raw =
        (update as { todos?: unknown }).todos ??
        (update as { entries?: unknown }).entries ??
        (update as { items?: unknown }).items;
      if (!Array.isArray(raw)) {
        return state;
      }
      return {
        ...state,
        todos: raw as SessionState["todos"],
      };
    }
    default: {
      // Soft-ignore unknown kinds that look like metadata; only soft-error opaque ones.
      // Soft-ignore must not finalize thought; hard error rows must finalize.
      const soft =
        /token|usage|context|compact|subagent|task|notification|hook/i;
      if (soft.test(String(kind))) {
        return state;
      }
      const message = `Unknown sessionUpdate: ${String(kind)}`;
      const timeline = finalizeLatestThought(state.timeline);
      return {
        ...state,
        timeline: [
          ...timeline,
          { kind: "error", id: nextTimelineId("err"), message },
        ],
      };
    }
  }
}
