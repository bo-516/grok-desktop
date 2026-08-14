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
import { applyUserMessageUpdate } from "./userMessageApply.js";
import { patchToolCard } from "./timelineToolCard.js";
import {
  appendOrMergeAgentText,
  appendOrMergeThought,
  finalizeLatestThought,
} from "./timelineTextMerge.js";
import {
  applyOrchestrationUpdate,
  isOrchestrationUpdate,
} from "./timelineOrchestration.js";
import {
  linkSpawnCardIfReady,
  readToolMeta,
  readToolRawInput,
} from "./subagentLink.js";
import {
  mergeTurnUsagePreservingOccupancy,
  parseTurnCompletedUsage,
} from "./sessionTokenUsage.js";
import { parseUsageUpdate } from "./sessionTokenUsageRpc.js";
import { withLiveStreamingStatus } from "./sessionLiveStatus.js";

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
 * Kind-specific reduce (timeline / plan / billed usage). Occupancy is merged
 * afterwards by {@link applySessionUpdate} in timeline.ts so every return path,
 * including early no-ops, can still refresh the context ring.
 * @param state Current session snapshot; not mutated in place.
 * @param update Event already extracted by extractSessionUpdate; unknown types are kept as soft error rows for diagnostics.
 * @returns Next state before live occupancy is merged.
 */
export function applySessionUpdateKind(
  state: SessionState,
  update: SessionUpdate,
): SessionState {
  const kind = update.sessionUpdate;

  // Orchestration is sidebar data: delegate before the visible-kind switch so
  // these events can never finalize a thought or append a timeline row.
  if (isOrchestrationUpdate(String(kind))) {
    return applyOrchestrationUpdate(state, update);
  }

  switch (kind) {
    case "user_message_chunk": {
      return applyUserMessageUpdate(state, update);
    }
    case "agent_message_chunk": {
      const text = chunkText(update);
      if (!text) {
        return state;
      }
      const base = withFinalizedThoughtIfVisible(state, kind);
      const merged = appendOrMergeAgentText(base.timeline, text);
      // Wire/seed state may omit lastAgentText; never concat onto undefined.
      const prevAgent = base.lastAgentText ?? "";
      return withLiveStreamingStatus({
        ...base,
        timeline: merged.timeline,
        // Seed claim on session/load must not dump history into lastAgentText.
        lastAgentText: merged.liveApplied ? prevAgent + text : prevAgent,
      });
    }
    case "agent_thought_chunk": {
      const text = chunkText(update);
      if (!text) {
        return state;
      }
      const timeline = appendOrMergeThought(state.timeline, text);
      // session/load forces idle so history is not live; a still-running turn
      // continues as thoughts/tools and must restore Working chrome.
      return withLiveStreamingStatus({ ...state, timeline });
    }
    case "tool_call": {
      const base = withFinalizedThoughtIfVisible(state, kind);
      const toolCallId = String(
        (update as { toolCallId?: string }).toolCallId ?? "",
      );
      if (!toolCallId) {
        return state;
      }
      const meta = readToolMeta(update as { _meta?: unknown });
      const rawInput = readToolRawInput(update as { rawInput?: unknown });
      const card = patchToolCard(base.toolCalls[toolCallId], {
        toolCallId,
        title: update.title as string | undefined,
        kind: update.kind as string | undefined,
        status: (update.status as string | undefined) ?? "pending",
        content: update.content,
        rawLocations: (update as { locations?: unknown }).locations,
        meta,
        rawInput,
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
      return withLiveStreamingStatus(
        linkSpawnCardIfReady(
          { ...base, toolCalls, timeline },
          toolCallId,
          card,
        ),
      );
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
      if (Object.prototype.hasOwnProperty.call(update, "_meta")) {
        patch.meta = readToolMeta(update as { _meta?: unknown });
      }
      if (Object.prototype.hasOwnProperty.call(update, "rawInput")) {
        patch.rawInput = readToolRawInput(update as { rawInput?: unknown });
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
      return withLiveStreamingStatus(
        linkSpawnCardIfReady(
          { ...base, toolCalls, timeline },
          toolCallId,
          card,
        ),
      );
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
    case "turn_completed": {
      // F-CTX-01: billed turn rollup. Occupancy lives on contextTokensUsed
      // and must survive this overwrite (turn_completed has no live stamp).
      // Silent metadata — must not finalize thought or append a timeline row.
      const tokenUsage = parseTurnCompletedUsage(update);
      if (!tokenUsage) {
        return state;
      }
      return {
        ...state,
        tokenUsage: mergeTurnUsagePreservingOccupancy(
          tokenUsage,
          state.tokenUsage,
        ),
      };
    }
    case "usage_update": {
      // ACP session-usage RFD: `used` is live window fill. Soft-ignore used
      // to swallow this kind via /usage/ and leave the composer ring at 0%.
      const tokenUsage = parseUsageUpdate(
        update as { sessionUpdate?: string } & Record<string, unknown>,
      );
      if (!tokenUsage) {
        return state;
      }
      return {
        ...state,
        tokenUsage: mergeTurnUsagePreservingOccupancy(
          tokenUsage,
          state.tokenUsage,
        ),
      };
    }
    default: {
      // Soft-ignore unknown kinds that look like metadata; only soft-error opaque ones.
      // Soft-ignore must not finalize thought; hard error rows must finalize.
      // `subagent` / `task` are gone: those kinds are handled above, and leaving
      // them here would let the fallback shadow real cases. Remaining vendor
      // kinds below are explicitly listed rather than pattern-matched.
      // `turn_completed` / `usage_update` are handled above — do not
      // re-list them as knownSilent (the /usage/ soft regex would no-op).
      const soft = /token|usage|context|compact|notification|hook/i;
      const knownSilent = new Set([
        "session_recap", // candidate for the session header
        "retry_state", // candidate for a transient status chip
        "image_compressed", // composer already reports its own result
        "image_dropped",
      ]);
      if (knownSilent.has(String(kind))) {
        return state;
      }
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
