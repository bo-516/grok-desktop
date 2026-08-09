/**
 * Pure timeline / session reducers for ACP session/update events.
 * No I/O — unit-tested entry points for UI and M0.
 */

import type {
  PlanEntry,
  SessionState,
  SessionUpdate,
  TimelineItem,
  ToolCallCard,
} from "./types.js";
import { normalizeAvailableCommands } from "./sessionMetadata.js";
import { nextTimelineId } from "./timelineId.js";
import { applyUserMessageChunk } from "./userMessageChunk.js";

export { nextTimelineId, resetTimelineIdCounter } from "./timelineId.js";
export { applyUserMessageChunk, userTextFromBlocks } from "./userMessageChunk.js";

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
      const text = chunkText(update);
      if (!text) {return state;}
      const base = withFinalizedThoughtIfVisible(state, kind);
      const timeline = applyUserMessageChunk(base.timeline, text);
      return { ...base, timeline };
    }
    case "agent_message_chunk": {
      const text = chunkText(update);
      if (!text) {return state;}
      const base = withFinalizedThoughtIfVisible(state, kind);
      const timeline = appendOrMergeText(base.timeline, "agent", text);
      return {
        ...base,
        timeline,
        lastAgentText: base.lastAgentText + text,
        status:
          base.status === "waiting_permission"
            ? base.status
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
      const base = withFinalizedThoughtIfVisible(state, kind);
      const toolCallId = String(
        (update as { toolCallId?: string }).toolCallId ?? "",
      );
      if (!toolCallId) {return state;}
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
      if (!toolCallId) {return state;}
      const existing = base.toolCalls[toolCallId];
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
      if (!Array.isArray(configOptions)) {return state;}
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
      const soft = /token|usage|context|compact|subagent|task|notification|hook/i;
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

/**
 * Read text payload from chunk-style session updates without tight unions.
 * Agents may send slightly different content shapes; missing text → empty.
 */
function chunkText(update: SessionUpdate): string {
  const content = (update as { content?: { text?: unknown } }).content;
  if (!content || typeof content !== "object") {return "";}
  return typeof content.text === "string" ? content.text : "";
}

/**
 * Map agent mode ids onto product chips (ask/plan/build).
 * Accepts common aliases from current_mode_update / permission-mode.
 * @param raw Agent mode string.
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
 * Merge agent text blocks (user path uses {@link applyUserMessageChunk}).
 * Claims unconfirmed seed agent rows on session/load replay instead of double-appending.
 * @param timeline Current timeline; not mutated in place.
 * @param kind Only `"agent"` is used by callers after user path split.
 * @param text Non-empty text; empty strings are filtered by the caller.
 * @returns New timeline array.
 */
function appendOrMergeText(
  timeline: TimelineItem[],
  kind: "user" | "agent",
  text: string,
): TimelineItem[] {
  if (kind === "user") {
    return applyUserMessageChunk(timeline, text);
  }
  return appendOrMergeAgentText(timeline, text);
}

/**
 * Append or merge an agent_message_chunk with seed-row claim semantics.
 * Unconfirmed `origin: "seed"` agent rows absorb matching replay in order.
 * Non-matching chunks abandon the current seed slot (keep seed body) and either
 * claim a later seed agent or append a live agent row — never silent-drop.
 * @param timeline Current ordered timeline.
 * @param text Non-empty agent chunk.
 * @returns Updated timeline without double-appending a full seed turn.
 */
function appendOrMergeAgentText(
  timeline: TimelineItem[],
  text: string,
): TimelineItem[] {
  let current = timeline;
  for (;;) {
    const pendingIdx = current.findIndex(
      (item) =>
        item.kind === "agent" &&
        item.origin === "seed" &&
        !item.agentConfirmed,
    );
    if (pendingIdx < 0) {
      break;
    }
    const result = tryAbsorbEchoIntoSeedTextRow(current, pendingIdx, text);
    current = result.timeline;
    if (result.absorbed) {
      return current;
    }
    // Slot abandoned (mismatch); try the next unconfirmed seed agent.
  }

  const last = current[current.length - 1];
  if (last && last.kind === "agent" && last.origin !== "seed") {
    return [
      ...current.slice(0, -1),
      { ...last, text: last.text + text },
    ];
  }
  return [
    ...current,
    {
      kind: "agent",
      id: nextTimelineId("agent"),
      text,
      origin: "agent",
    },
  ];
}

/**
 * Merge consecutive reasoning chunks; claim unconfirmed seed thoughts on resume.
 * Non-matching chunks abandon the pending seed thought and start a live row so
 * incomplete session/load never permanently blocks later reasoning.
 * @param timeline Current ordered timeline.
 * @param text Non-empty reasoning text; empty text is filtered by the caller first.
 * @returns Updated Thought list; the first live block carries a start time and default collapsed flag.
 */
function appendOrMergeThought(
  timeline: TimelineItem[],
  text: string,
): TimelineItem[] {
  const last = timeline[timeline.length - 1];
  // Live incomplete thought (including mid-stream origin agent / untagged).
  if (
    last &&
    last.kind === "thought" &&
    last.completedAt === undefined &&
    last.origin !== "seed"
  ) {
    return [
      ...timeline.slice(0, -1),
      { ...last, text: last.text + text },
    ];
  }

  let current = timeline;
  for (;;) {
    const pendingIdx = current.findIndex(
      (item) =>
        item.kind === "thought" &&
        item.origin === "seed" &&
        !item.agentConfirmed,
    );
    if (pendingIdx < 0) {
      break;
    }
    const result = tryAbsorbEchoIntoSeedTextRow(current, pendingIdx, text);
    current = result.timeline;
    if (result.absorbed) {
      return current;
    }
  }

  return [
    ...current,
    {
      kind: "thought",
      id: nextTimelineId("thought"),
      text,
      collapsed: true,
      startedAt: Date.now(),
      origin: "agent",
    },
  ];
}

/**
 * Whether an incoming chunk is compatible with claiming a seed agent/thought body.
 * Empty echo-acc must not treat arbitrary text as a cumulative resend of the seed.
 * @param existing Authoritative seed body text.
 * @param acc Prior accumulated echo for this slot (may be empty).
 * @param text Incoming non-empty chunk.
 * @returns True when the chunk continues or completes claim of this seed row.
 */
function isCompatibleSeedEcho(
  existing: string,
  acc: string,
  text: string,
): boolean {
  // Equal, progressive prefix of seed, or longer superseding body.
  if (text === existing || existing.startsWith(text)) {
    return true;
  }
  if (text.startsWith(existing) && text.length > existing.length) {
    return true;
  }
  // Chunked append toward seed (acc + fragment).
  if (existing.startsWith(acc + text) || acc + text === existing) {
    return true;
  }
  // Cumulative full-message resend only after we already have related progress,
  // or when the full resend itself is still a prefix/equal of the seed body.
  if (acc.length > 0 && text.startsWith(acc)) {
    return true;
  }
  if (acc.length === 0 && (existing.startsWith(text) || text.startsWith(existing))) {
    return true;
  }
  return false;
}

/**
 * Try to absorb session/load echo into one seed agent/thought row.
 * On mismatch, abandons that slot (`agentConfirmed: true`, body unchanged) so a
 * later seed row or a live append can accept the chunk — never silent-drop.
 * @param timeline Full timeline (immutable update).
 * @param idx Index of the pending seed agent/thought item.
 * @param text Incoming chunk.
 * @returns `absorbed: true` when the chunk claimed progress on this slot;
 *          `absorbed: false` when the slot was abandoned for mismatch.
 */
function tryAbsorbEchoIntoSeedTextRow(
  timeline: TimelineItem[],
  idx: number,
  text: string,
): { timeline: TimelineItem[]; absorbed: boolean } {
  const item = timeline[idx];
  if (!item || (item.kind !== "agent" && item.kind !== "thought")) {
    return { timeline, absorbed: false };
  }

  const existing = item.text;
  const acc = item.agentEchoAcc ?? "";

  if (!isCompatibleSeedEcho(existing, acc, text)) {
    const abandoned = {
      ...item,
      agentConfirmed: true as const,
    };
    return {
      timeline: replaceTimelineItem(timeline, idx, abandoned),
      absorbed: false,
    };
  }

  // Agent has a longer complete sentence than cached seed — adopt it.
  if (text.startsWith(existing) && text.length > existing.length) {
    const next = {
      ...item,
      text,
      agentEchoAcc: text,
      agentConfirmed: true as const,
    };
    return {
      timeline: replaceTimelineItem(timeline, idx, next),
      absorbed: true,
    };
  }

  let nextAcc = acc;
  // Cumulative resend of the same growing message (only when already related).
  if (acc.length > 0 && text.startsWith(acc) && text.length >= acc.length) {
    nextAcc = text;
  } else if (existing.startsWith(acc + text) || acc + text === existing) {
    nextAcc = acc + text;
  } else if (text === existing || existing.startsWith(text)) {
    // Full-message or progressive prefix replay of the authoritative body.
    if (text.length >= acc.length) {
      nextAcc = text;
    }
  } else {
    // Compatible only via longer-supersede path handled above; should not reach.
    const abandoned = { ...item, agentConfirmed: true as const };
    return {
      timeline: replaceTimelineItem(timeline, idx, abandoned),
      absorbed: false,
    };
  }

  const confirmed =
    nextAcc === existing ||
    (nextAcc.length >= existing.length && nextAcc.startsWith(existing));

  const next = {
    ...item,
    agentEchoAcc: nextAcc,
    agentConfirmed: confirmed,
  };
  return {
    timeline: replaceTimelineItem(timeline, idx, next),
    absorbed: true,
  };
}

/**
 * Mark every unconfirmed seed agent/thought as confirmed so a new local turn
 * cannot absorb into stale session/load slots (incomplete resume safety).
 * Seed bodies are preserved; only the claim latch flips.
 * @param timeline Current timeline; not mutated in place.
 * @returns Same reference when nothing changes; otherwise a new array.
 */
export function abandonUnconfirmedSeedContent(
  timeline: TimelineItem[],
): TimelineItem[] {
  let changed = false;
  const next = timeline.map((item) => {
    if (
      (item.kind === "agent" || item.kind === "thought") &&
      item.origin === "seed" &&
      !item.agentConfirmed
    ) {
      changed = true;
      return { ...item, agentConfirmed: true };
    }
    return item;
  });
  return changed ? next : timeline;
}

/**
 * Immutable replace of one timeline slot.
 * @param timeline Source array.
 * @param idx Index to replace.
 * @param item New item at idx.
 */
function replaceTimelineItem(
  timeline: TimelineItem[],
  idx: number,
  item: TimelineItem,
): TimelineItem[] {
  return [...timeline.slice(0, idx), item, ...timeline.slice(idx + 1)];
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
