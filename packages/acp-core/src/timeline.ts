/**
 * Pure timeline / session reducers for ACP session/update events.
 * No I/O — unit-tested entry points for UI and M0.
 */

import type {
  ContentBlock,
  PlanEntry,
  SessionState,
  SessionUpdate,
  TimelineItem,
  ToolCallCard,
} from "./types.js";
import { normalizeAvailableCommands } from "./sessionMetadata.js";
import { nextTimelineId } from "./timelineId.js";

export { nextTimelineId, resetTimelineIdCounter } from "./timelineId.js";

/**
 * Deep-ish merge for tool card patches.
 * - Undefined fields on the patch are ignored (do not wipe).
 * - `content` is only replaced when the patch explicitly provides content.
 * - Nested plain objects are merged one level; arrays replace when provided.
 */
export function patchToolCard(
  existing: ToolCallCard | undefined,
  patch: Partial<ToolCallCard> & { toolCallId: string },
): ToolCallCard {
  const base: ToolCallCard = existing
    ? { ...existing, meta: existing.meta ? { ...existing.meta } : undefined }
    : { toolCallId: patch.toolCallId };

  const next: ToolCallCard = { ...base, toolCallId: patch.toolCallId };

  if (patch.title !== undefined) {next.title = patch.title;}
  if (patch.kind !== undefined) {next.kind = patch.kind;}
  if (patch.status !== undefined) {next.status = patch.status;}
  if (patch.content !== undefined) {next.content = patch.content;}
  if (patch.rawLocations !== undefined) {next.rawLocations = patch.rawLocations;}
  if (patch.meta !== undefined) {
    next.meta = { ...(base.meta ?? {}), ...patch.meta };
  }

  // Preserve any extra agent fields stored under meta from raw updates
  return next;
}

/**
 * Extract a SessionUpdate from a session/update notification params object.
 * Accepts both `{ update: {...} }` and a bare update object.
 */
export function extractSessionUpdate(params: unknown): SessionUpdate | null {
  if (!params || typeof params !== "object") {return null;}
  const p = params as Record<string, unknown>;
  const update = (p.update ?? p) as Record<string, unknown>;
  if (!update || typeof update !== "object") {return null;}
  if (typeof update.sessionUpdate !== "string") {return null;}
  return update as SessionUpdate;
}

/**
 * Create an empty session state for a new or loaded session.
 */
export function createSessionState(init: {
  id: string;
  workspace?: string;
  model?: string;
  mode?: SessionState["mode"];
}): SessionState {
  return {
    id: init.id,
    workspace: init.workspace ?? "",
    model: init.model ?? "",
    mode: init.mode ?? "build",
    status: "idle",
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

/**
 * Immutably apply one ACP `session/update`, and end active Thinking when a non-Thought event arrives.
 * @param state Current session snapshot; not mutated in place.
 * @param update Event already extracted by extractSessionUpdate; unknown types are kept as soft error rows for diagnostics.
 * @returns New session state shared by UI, bridge, and tests.
 */
export function applySessionUpdate(
  state: SessionState,
  update: SessionUpdate,
): SessionState {
  const kind = update.sessionUpdate;
  const stateWithCompletedThought =
    kind === "agent_thought_chunk"
      ? state
      : {
          ...state,
          timeline: finalizeLatestThought(state.timeline),
        };

  switch (kind) {
    case "user_message_chunk": {
      const text = chunkText(update);
      if (!text) {return state;}
      const timeline = appendOrMergeText(
        stateWithCompletedThought.timeline,
        "user",
        text,
      );
      return { ...stateWithCompletedThought, timeline };
    }
    case "agent_message_chunk": {
      const text = chunkText(update);
      if (!text) {return state;}
      const timeline = appendOrMergeText(
        stateWithCompletedThought.timeline,
        "agent",
        text,
      );
      return {
        ...stateWithCompletedThought,
        timeline,
        lastAgentText: stateWithCompletedThought.lastAgentText + text,
        status:
          stateWithCompletedThought.status === "waiting_permission"
            ? stateWithCompletedThought.status
            : "streaming",
      };
    }
    case "agent_thought_chunk": {
      const text = chunkText(update);
      if (!text) {return state;}
      const timeline = appendOrMergeThought(state.timeline, text);
      return { ...state, timeline };
    }
    case "tool_call": {
      const toolCallId = String(
        (update as { toolCallId?: string }).toolCallId ?? "",
      );
      if (!toolCallId) {return state;}
      const card = patchToolCard(stateWithCompletedThought.toolCalls[toolCallId], {
        toolCallId,
        title: update.title as string | undefined,
        kind: update.kind as string | undefined,
        status: (update.status as string | undefined) ?? "pending",
        content: update.content,
        rawLocations: (update as { locations?: unknown }).locations,
      });
      const toolCalls = {
        ...stateWithCompletedThought.toolCalls,
        [toolCallId]: card,
      };
      const already = stateWithCompletedThought.timeline.some(
        (t) => t.kind === "tool" && t.toolCallId === toolCallId,
      );
      const timeline = already
        ? stateWithCompletedThought.timeline
        : [
            ...stateWithCompletedThought.timeline,
            {
              kind: "tool" as const,
              id: nextTimelineId("tool"),
              toolCallId,
            },
          ];
      return { ...stateWithCompletedThought, toolCalls, timeline };
    }
    case "tool_call_update": {
      const toolCallId = String(
        (update as { toolCallId?: string }).toolCallId ?? "",
      );
      if (!toolCallId) {return state;}
      const existing = stateWithCompletedThought.toolCalls[toolCallId];
      const patch: Partial<ToolCallCard> & { toolCallId: string } = {
        toolCallId,
      };
      if (update.title !== undefined) {patch.title = update.title as string;}
      if (update.kind !== undefined) {patch.kind = update.kind as string;}
      if (update.status !== undefined) {patch.status = update.status as string;}
      // Only set content when the update actually carries it — status-only must not wipe
      if (Object.prototype.hasOwnProperty.call(update, "content")) {
        patch.content = update.content;
      }
      if (Object.prototype.hasOwnProperty.call(update, "locations")) {
        patch.rawLocations = (update as { locations?: unknown }).locations;
      }
      const card = patchToolCard(existing, patch);
      const toolCalls = {
        ...stateWithCompletedThought.toolCalls,
        [toolCallId]: card,
      };
      // If we never saw tool_call, still insert a timeline pointer
      const already = stateWithCompletedThought.timeline.some(
        (t) => t.kind === "tool" && t.toolCallId === toolCallId,
      );
      const timeline = already
        ? stateWithCompletedThought.timeline
        : [
            ...stateWithCompletedThought.timeline,
            {
              kind: "tool" as const,
              id: nextTimelineId("tool"),
              toolCallId,
            },
          ];
      return { ...stateWithCompletedThought, toolCalls, timeline };
    }
    case "plan": {
      const entries = (update.entries ??
        (update as { plan?: PlanEntry[] }).plan ??
        []) as PlanEntry[];
      return { ...stateWithCompletedThought, plan: entries };
    }
    case "available_commands_update": {
      return {
        ...stateWithCompletedThought,
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
      return mode ? { ...stateWithCompletedThought, mode } : stateWithCompletedThought;
    }
    case "session_info_update": {
      // Real grok-build session title updates only touch metadata and must never enter the error timeline.
      const next: SessionState = { ...stateWithCompletedThought };
      if (Object.prototype.hasOwnProperty.call(update, "title")) {
        const titleRaw = (update as { title?: string | null }).title;
        if (titleRaw === null) {
          delete next.title;
        } else if (typeof titleRaw === "string") {
          const trimmed = titleRaw.trim();
          if (trimmed) {next.title = trimmed;}
          else {delete next.title;}
        }
      }
      if (Object.prototype.hasOwnProperty.call(update, "updatedAt")) {
        const updatedAtRaw = (update as { updatedAt?: string | null }).updatedAt;
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
      if (!Array.isArray(configOptions)) {return stateWithCompletedThought;}
      return { ...stateWithCompletedThought, configOptions };
    }
    default: {
      // Unknown sessionUpdate — surface as a soft error item once
      const message = `Unknown sessionUpdate: ${String(kind)}`;
      return {
        ...stateWithCompletedThought,
        timeline: [
          ...stateWithCompletedThought.timeline,
          { kind: "error", id: nextTimelineId("err"), message },
        ],
      };
    }
  }
}

/**
 * Read text payload from chunk-style session updates without tight unions.
 * Agents may send slightly different content shapes; missing text → empty.
 */
function chunkText(update: SessionUpdate): string {
  const content = (update as { content?: { text?: unknown } }).content;
  if (!content || typeof content !== "object") {return "";}
  return typeof content.text === "string" ? content.text : "";
}

function normalizeMode(raw: string): SessionState["mode"] | null {
  const m = raw.toLowerCase();
  if (m === "ask" || m === "plan" || m === "build") {return m;}
  return null;
}

/**
 * Merge agent/user text blocks.
 * The user path aligns with optimistic `appendUserPrompt`: when an agent-replayed `user_message_chunk`
 * matches the last user text or extends it as a prefix, overwrite/extend instead of concatenating the full string twice.
 * @param timeline Current timeline; not mutated in place.
 * @param kind user or agent.
 * @param text Non-empty text; empty strings are filtered by the caller.
 * @returns New timeline array.
 */
function appendOrMergeText(
  timeline: TimelineItem[],
  kind: "user" | "agent",
  text: string,
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  if (last && last.kind === kind) {
    if (kind === "agent" && last.kind === "agent") {
      return [
        ...timeline.slice(0, -1),
        { ...last, text: last.text + text },
      ];
    }
    if (kind === "user" && last.kind === "user") {
      const blocks = mergeUserText(last.blocks, text);
      return [...timeline.slice(0, -1), { ...last, blocks }];
    }
  }
  if (kind === "agent") {
    return [
      ...timeline,
      { kind: "agent", id: nextTimelineId("agent"), text },
    ];
  }
  return [
    ...timeline,
    {
      kind: "user",
      id: nextTimelineId("user"),
      blocks: [{ type: "text", text }],
    },
  ];
}

/**
 * Merge user text blocks, compatible with optimistic send and agent replay of the same sentence.
 * @param blocks Content blocks of the last user item.
 * @param text Incremental or full sentence pushed by the agent.
 * @returns Merged blocks; identical text is not duplicated, prefix relationships keep the longer one, otherwise append.
 */
function mergeUserText(blocks: ContentBlock[], text: string): ContentBlock[] {
  const last = blocks[blocks.length - 1];
  if (last && last.type === "text") {
    const prev = last.text;
    // Optimistic prompt already wrote the full sentence; agent echoes the same → keep as-is
    if (text === prev || prev.endsWith(text)) {
      return blocks;
    }
    // Agent chunked replay: extend when we already have the prefix
    if (text.startsWith(prev)) {
      return [...blocks.slice(0, -1), { type: "text", text }];
    }
    // True increment (not replay) — concatenate
    return [
      ...blocks.slice(0, -1),
      { type: "text", text: prev + text },
    ];
  }
  return [...blocks, { type: "text", text }];
}

/**
 * Merge consecutive reasoning chunks; a new chunk after a completed Thought must start a new row.
 * @param timeline Current ordered timeline.
 * @param text Non-empty reasoning text; empty text is filtered by the caller first.
 * @returns Updated Thought list; the first block carries a start time and default collapsed flag.
 */
function appendOrMergeThought(
  timeline: TimelineItem[],
  text: string,
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  if (last && last.kind === "thought" && last.completedAt === undefined) {
    return [
      ...timeline.slice(0, -1),
      { ...last, text: last.text + text },
    ];
  }
  return [
    ...timeline,
    {
      kind: "thought",
      id: nextTimelineId("thought"),
      text,
      collapsed: true,
      startedAt: Date.now(),
    },
  ];
}

/**
 * Close the last Thinking fragment that is still streaming.
 * @param timeline Current timeline; keeps the same reference when the tail is not an incomplete thought.
 * @param completedAt Optional end time; defaults to now when omitted.
 * @returns New list with end time marked, or the original list when no change is needed.
 */
export function finalizeLatestThought(
  timeline: TimelineItem[],
  completedAt = Date.now(),
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  if (!last || last.kind !== "thought" || last.completedAt !== undefined) {
    return timeline;
  }
  return [...timeline.slice(0, -1), { ...last, completedAt }];
}
