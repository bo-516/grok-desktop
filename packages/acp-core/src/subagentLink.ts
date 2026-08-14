/**
 * Identify grok-build's subagent-related tool cards and link them to the
 * orchestration cards produced by `timelineOrchestration`.
 *
 * Identification reads protocol fields only (`_meta["x.ai/tool"].name` and the
 * `subagent_id:` line the CLI writes into the spawn card body). Matching on
 * human-facing titles is deliberately not done here — the previous
 * implementation did and mislabeled every tool card whose title said "plan".
 * Pure — no I/O.
 */

import type { SessionState, SubagentCard, ToolCallCard } from "./types.js";

/** Vendor meta key carrying grok-build's tool descriptor. */
const VENDOR_TOOL_META_KEY = "x.ai/tool";

/** Tool names the subagent UI renders specially. */
export const SPAWN_SUBAGENT_TOOL = "spawn_subagent";
export const WAIT_SUBAGENT_TOOL = "get_command_or_subagent_output";
export const KILL_SUBAGENT_TOOL = "kill_command_or_subagent";

/**
 * Flatten tool-card content into a single text blob for id-line parsing.
 * Accepts ACP content-part arrays, nested content wrappers, or plain strings.
 * Diff parts are skipped so edit bodies never pollute the parse.
 * @param content Raw `ToolCallCard.content` from a session update.
 * @returns Concatenated text; empty when content is missing or non-textual.
 */
export function flattenToolText(content: unknown): string {
  if (content == null) {
    return "";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const item of content) {
      const piece = flattenToolTextPart(item);
      if (piece) {
        chunks.push(piece);
      }
    }
    return chunks.join("\n");
  }
  if (typeof content === "object") {
    return flattenToolTextPart(content);
  }
  return "";
}

/**
 * Extract text from one content part (or nested wrapper).
 * @param part Single content fragment; non-objects yield empty.
 * @returns Text body, or empty when the part is a diff / non-textual.
 */
function flattenToolTextPart(part: unknown): string {
  if (part == null) {
    return "";
  }
  if (typeof part === "string") {
    return part;
  }
  if (typeof part !== "object" || Array.isArray(part)) {
    return flattenToolText(part);
  }
  const rec = part as Record<string, unknown>;
  if (rec.type === "diff") {
    return "";
  }
  if (typeof rec.text === "string" && rec.text) {
    return rec.text;
  }
  const nested = rec.content;
  if (typeof nested === "string" && nested) {
    return nested;
  }
  if (Array.isArray(nested) || (nested && typeof nested === "object")) {
    return flattenToolText(nested);
  }
  return "";
}

/**
 * Read the vendor tool name off a card's `_meta`.
 * @param card Tool card from SessionState.toolCalls, possibly undefined.
 * @returns Tool name (e.g. `spawn_subagent`), or undefined for plain tools.
 */
export function vendorToolName(card: ToolCallCard | undefined): string | undefined {
  const descriptor = card?.meta?.[VENDOR_TOOL_META_KEY];
  if (!descriptor || typeof descriptor !== "object") {
    return undefined;
  }
  const name = (descriptor as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** True when the card is a subagent spawn (fan-out row in the turn rail). */
export function isSpawnSubagentCard(card: ToolCallCard | undefined): boolean {
  return vendorToolName(card) === SPAWN_SUBAGENT_TOOL;
}

/** True when the card is a wait barrier on one or more subagent task ids. */
export function isWaitSubagentCard(card: ToolCallCard | undefined): boolean {
  return vendorToolName(card) === WAIT_SUBAGENT_TOOL;
}

/** True when the card is a kill/cancel for a subagent or background task. */
export function isKillSubagentCard(card: ToolCallCard | undefined): boolean {
  return vendorToolName(card) === KILL_SUBAGENT_TOOL;
}

/** Matches the `subagent_id: <uuid>` line the CLI writes into the spawn body. */
const SUBAGENT_ID_LINE = /^subagent_id:\s*([0-9a-fA-F-]{8,})\s*$/m;

/**
 * Extract the spawned subagent id from a completed spawn card body.
 *
 * This is the only in-band link between a timeline tool card and the
 * `subagent_spawned` orchestration event: the event carries no tool_call_id and
 * the two arrive interleaved (observed: spawn card #4 completes *after* all
 * four events). Callers must therefore tolerate either order.
 * @param content Raw `ToolCallCard.content` (ACP content part array or string).
 * @returns Subagent id, or undefined before the card completes / has no id line.
 */
export function parseSpawnedSubagentId(content: unknown): string | undefined {
  const text = flattenToolText(content);
  const match = text.match(SUBAGENT_ID_LINE);
  return match?.[1];
}

/**
 * Task ids a wait-barrier card is blocking on.
 * @param card Card whose vendor name is `get_command_or_subagent_output`.
 * @returns Ids in agent-declared order; empty when the input is missing.
 */
export function waitBarrierTaskIds(card: ToolCallCard | undefined): string[] {
  const ids = card?.rawInput?.task_ids;
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : [];
}

/**
 * Keep only UI-needed keys from agent `rawInput`.
 * Drops large fields like `prompt` so they never enter SessionState / catalog
 * persistence. Empty result yields undefined so callers can skip the patch.
 * @param raw Raw `rawInput` object from a tool_call / tool_call_update.
 * @returns Sanitized bag, or undefined when nothing useful remains.
 */
export function sanitizeToolRawInput(
  raw: unknown,
): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.description === "string" && src.description.trim()) {
    out.description = src.description.trim();
  }
  if (Array.isArray(src.task_ids)) {
    const ids = src.task_ids.filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    if (ids.length > 0) {
      out.task_ids = ids;
    }
  }
  // Pass through task_id for kill cards (single id, not the wait list).
  if (typeof src.task_id === "string" && src.task_id.trim()) {
    out.task_id = src.task_id.trim();
  }
  // Role type from spawn input (general-purpose / explore / plan).
  if (typeof src.subagent_type === "string" && src.subagent_type.trim()) {
    out.subagent_type = src.subagent_type.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Agent-written spawn description for a stub / roster card.
 * Prefers sanitized `rawInput.description`; falls back to a non-generic title.
 * @param card Spawn tool card (may lack both fields before the first update).
 * @returns Trimmed label, or empty when nothing usable is on the card.
 */
export function spawnCardDescription(card: ToolCallCard): string {
  const raw = card.rawInput?.description;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  const title = card.title?.trim() ?? "";
  if (title && title !== SPAWN_SUBAGENT_TOOL) {
    return title;
  }
  return "";
}

/**
 * Spawn `subagent_type` from sanitized rawInput.
 * @param card Spawn tool card.
 * @returns Type string, or empty when the agent omitted it.
 */
export function spawnCardType(card: ToolCallCard): string {
  const raw = card.rawInput?.subagent_type;
  return typeof raw === "string" && raw.trim() ? raw.trim() : "";
}

/**
 * True when the spawn tool itself failed (child never started).
 * A completed spawn only means the child started — not that it finished.
 * @param card Spawn tool card status.
 */
function spawnToolFailed(card: ToolCallCard): boolean {
  const status = String(card.status ?? "").trim().toLowerCase();
  return status === "failed" || status === "error";
}

/**
 * Record the spawn join key and ensure an Agents-rail card exists.
 *
 * Spawn-tool completion writes `subagent_id:` into the body. That is enough
 * to list the child even when `_x.ai/session/update` `subagent_spawned` is
 * late, dropped, or omitted from session/load replay. First link write wins.
 *
 * @param state Session snapshot after the tool card was patched.
 * @param toolCallId Timeline tool card id.
 * @param card Patched card (ignored when it is not a spawn).
 * @returns State with `subagentLinks` / `subagents` updated, or the input
 *   state when the card is not a completed spawn with an id line.
 */
export function linkSpawnCardIfReady(
  state: SessionState,
  toolCallId: string,
  card: ToolCallCard,
): SessionState {
  if (!isSpawnSubagentCard(card)) {
    return state;
  }
  const spawnedId = parseSpawnedSubagentId(card.content);
  if (!spawnedId) {
    return state;
  }
  // First link write wins — a later spawn card must not steal the join key.
  const existingLink = state.subagentLinks?.[spawnedId];
  const subagentLinks = existingLink
    ? (state.subagentLinks ?? {})
    : { ...(state.subagentLinks ?? {}), [spawnedId]: toolCallId };
  const existing = state.subagents?.[spawnedId];
  if (!existing) {
    const stub: SubagentCard = {
      subagentId: spawnedId,
      // grok-build uses the same id for the child session.
      childSessionId: spawnedId,
      type: spawnCardType(card),
      description: spawnCardDescription(card),
      status: spawnToolFailed(card) ? "failed" : "running",
      toolCallId,
    };
    return {
      ...state,
      subagentLinks,
      subagents: { ...(state.subagents ?? {}), [spawnedId]: stub },
    };
  }
  if (existing.toolCallId) {
    return existingLink ? state : { ...state, subagentLinks };
  }
  return {
    ...state,
    subagentLinks,
    subagents: {
      ...(state.subagents ?? {}),
      [spawnedId]: { ...existing, toolCallId },
    },
  };
}

/**
 * Read the vendor `_meta` bag off a raw tool update.
 * Kept as an opaque record: the UI only looks up known keys (`x.ai/tool`), and
 * typing it tighter would drop fields future CLI versions add.
 * @param update Raw tool_call / tool_call_update payload.
 * @returns Meta record, or undefined when absent / wrong type.
 */
export function readToolMeta(update: {
  _meta?: unknown;
  [key: string]: unknown;
}): Record<string, unknown> | undefined {
  const meta = update._meta;
  return meta && typeof meta === "object" && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : undefined;
}

/**
 * Read and sanitize `rawInput` from a raw tool update.
 * @param update Raw tool_call / tool_call_update payload.
 * @returns Sanitized rawInput, or undefined when absent / empty after sanitize.
 */
export function readToolRawInput(update: {
  rawInput?: unknown;
  [key: string]: unknown;
}): Record<string, unknown> | undefined {
  return sanitizeToolRawInput(update.rawInput);
}
