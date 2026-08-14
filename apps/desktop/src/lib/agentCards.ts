/**
 * Pure helpers for session-scoped agent / subagent cards.
 * Round grouping, running counts, duration formatting, and list mapping —
 * used by the Agents context rail and L1 inline subagent groups.
 * Replaces orchestrationCards + TasksPanel formatters.
 * Pure — no I/O, no store.
 */

import {
  isSpawnSubagentCard,
  isWaitSubagentCard,
  parseSpawnedSubagentId,
  spawnCardDescription,
  spawnCardType,
  waitBarrierTaskIds,
  type BackgroundTaskCard,
  type SubagentCard,
  type ToolCallCard,
} from "@grok-desktop/acp-core";

/** Prefix for roster stubs that only have a spawn toolCallId (no body id yet). */
const SPAWN_STUB_PREFIX = "spawn:";

/** One round of fan-out subagents sharing a parentPromptId. */
export type SubagentRound = {
  /**
   * Parent turn id that spawned these cards; `"ungrouped"` when the agent
   * omitted `parentPromptId` (sorted last so known rounds stay stable).
   */
  parentPromptId: string;
  /** Cards in spawn-map insertion order within the round. */
  cards: SubagentCard[];
};

/**
 * List subagent cards in insertion (spawn) order.
 * @param subagents SessionState.subagents map, or undefined when none yet.
 * @returns Array of cards; empty when the map is missing.
 */
export function listSubagentCards(
  subagents: Record<string, SubagentCard> | undefined,
): SubagentCard[] {
  return Object.values(subagents ?? {});
}

/**
 * List background task cards in insertion order.
 * @param backgroundTasks SessionState.backgroundTasks map, or undefined.
 * @returns Array of cards; empty when the map is missing.
 */
export function listBackgroundTaskCards(
  backgroundTasks: Record<string, BackgroundTaskCard> | undefined,
): BackgroundTaskCard[] {
  return Object.values(backgroundTasks ?? {});
}

/**
 * Count subagents currently running in the given map (current session only).
 * Deliberately not cross-session pool streams — that was the old Tasks badge bug.
 * @param subagents SessionState.subagents map, or undefined.
 * @returns Number of cards with status === "running".
 */
export function countRunningSubagents(
  subagents: Record<string, SubagentCard> | undefined,
): number {
  let n = 0;
  for (const card of Object.values(subagents ?? {})) {
    if (card.status === "running") {
      n += 1;
    }
  }
  return n;
}

/**
 * Task ids a completed wait barrier has joined.
 * Used to promote spawn-stub cards from running → completed when
 * `subagent_finished` never arrived (session/load often omits it).
 * @param toolCalls Session tool-call map.
 * @returns Set of child / subagent ids the parent already waited on.
 */
function completedWaitTaskIds(
  toolCalls: Record<string, ToolCallCard | undefined>,
): Set<string> {
  const ids = new Set<string>();
  for (const card of Object.values(toolCalls)) {
    if (!card || !isWaitSubagentCard(card)) {
      continue;
    }
    if (normalizeSubagentStatus(card.status) !== "completed") {
      continue;
    }
    for (const id of waitBarrierTaskIds(card)) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Inferred stub status from the spawn tool + optional completed wait.
 * Spawn `completed` means the child started, not that it finished.
 * @param toolStatus Normalized spawn-tool status.
 * @param parsedId Body `subagent_id` when the spawn card has finished writing.
 * @param waitDone Ids a completed wait barrier joined.
 */
function inferredSpawnStatus(
  toolStatus: string,
  parsedId: string | undefined,
  waitDone: Set<string>,
): string {
  if (toolStatus === "failed") {
    return "failed";
  }
  if (parsedId && waitDone.has(parsedId)) {
    return "completed";
  }
  if (toolStatus === "completed" || toolStatus === "running") {
    return "running";
  }
  return "pending";
}

/**
 * Find an existing orchestration / stub card for one spawn tool.
 * Matches by parsed body id, childSessionId, or toolCallId.
 * @param cards Roster map being built.
 * @param parsedId Body id, or undefined before the spawn card completes.
 * @param toolCallId Spawn tool id.
 */
function findRosterCard(
  cards: Record<string, SubagentCard>,
  parsedId: string | undefined,
  toolCallId: string,
): SubagentCard | undefined {
  if (parsedId && cards[parsedId]) {
    return cards[parsedId];
  }
  for (const card of Object.values(cards)) {
    if (
      parsedId &&
      (card.subagentId === parsedId || card.childSessionId === parsedId)
    ) {
      return card;
    }
    if (card.toolCallId === toolCallId) {
      return card;
    }
  }
  return undefined;
}

/**
 * Union orchestration cards with spawn-tool stubs so the Agents rail
 * matches the L1 `Subagents ×N` group.
 *
 * The timeline groups `spawn_subagent` tools even when `session.subagents`
 * is empty (`subagent_spawned` late, dropped, or omitted from load replay).
 * The companion must not stay on "No subagents in this session yet" in
 * that case. Orchestration cards always win on identity; stubs only fill
 * gaps and may promote running → completed when a wait barrier finished.
 *
 * @param subagents SessionState.subagents map, or undefined when none yet.
 * @param toolCalls SessionState.toolCalls map (spawn + wait cards).
 * @returns Combined map, or undefined when both sides are empty.
 */
export function mergeSubagentsWithSpawnTools(
  subagents: Record<string, SubagentCard> | undefined,
  toolCalls: Record<string, ToolCallCard | undefined> | undefined,
): Record<string, SubagentCard> | undefined {
  const calls = toolCalls ?? {};
  const waitDone = completedWaitTaskIds(calls);
  const out: Record<string, SubagentCard> = { ...(subagents ?? {}) };

  for (const card of Object.values(calls)) {
    if (!card || !isSpawnSubagentCard(card)) {
      continue;
    }
    const toolCallId = card.toolCallId;
    if (!toolCallId) {
      continue;
    }
    const parsedId = parseSpawnedSubagentId(card.content);
    const existing = findRosterCard(out, parsedId, toolCallId);
    const toolStatus = normalizeSubagentStatus(card.status);
    const inferred = inferredSpawnStatus(toolStatus, parsedId, waitDone);
    const description = spawnCardDescription(card);
    const type = spawnCardType(card);
    if (existing) {
      const existingStatus = normalizeSubagentStatus(existing.status);
      const terminal =
        existingStatus === "completed" || existingStatus === "failed";
      const next: SubagentCard = { ...existing };
      if (!next.toolCallId) {
        next.toolCallId = toolCallId;
      }
      if (!next.description && description) {
        next.description = description;
      }
      if (!next.type && type) {
        next.type = type;
      }
      if (!next.childSessionId && parsedId) {
        next.childSessionId = parsedId;
      }
      if (!terminal && inferred === "completed") {
        next.status = "completed";
      }
      if (!terminal && inferred === "failed") {
        next.status = "failed";
      }
      out[existing.subagentId] = next;
      continue;
    }
    const subagentId = parsedId || `${SPAWN_STUB_PREFIX}${toolCallId}`;
    out[subagentId] = {
      subagentId,
      childSessionId: parsedId ?? "",
      type,
      description,
      status: inferred,
      toolCallId,
    };
  }

  if (Object.keys(out).length === 0) {
    return subagents;
  }
  return out;
}

/**
 * Group subagent cards by `parentPromptId` (fan-out round).
 * Cards without a prompt id land in an `"ungrouped"` bucket sorted last.
 * Within a round, insertion order from the map is preserved.
 * Callers that want spawn-tool stubs must merge via
 * {@link mergeSubagentsWithSpawnTools} first.
 * @param subagents SessionState.subagents map, or undefined.
 * @returns Ordered rounds (known prompt ids first, ungrouped last).
 */
export function groupSubagentsByRound(
  subagents: Record<string, SubagentCard> | undefined,
): SubagentRound[] {
  const order: string[] = [];
  const buckets = new Map<string, SubagentCard[]>();
  for (const card of listSubagentCards(subagents)) {
    const key = card.parentPromptId?.trim() || "ungrouped";
    const bucket = buckets.get(key);
    if (!bucket) {
      order.push(key);
      buckets.set(key, [card]);
    } else {
      bucket.push(card);
    }
  }
  // Known rounds keep insertion order; ungrouped always last.
  const known = order.filter((k) => k !== "ungrouped");
  const rounds: SubagentRound[] = known.map((parentPromptId) => ({
    parentPromptId,
    cards: buckets.get(parentPromptId) ?? [],
  }));
  if (buckets.has("ungrouped")) {
    rounds.push({
      parentPromptId: "ungrouped",
      cards: buckets.get("ungrouped") ?? [],
    });
  }
  return rounds;
}

/**
 * Format a subagent duration for UI lines.
 * Missing / non-finite / negative → empty string (never "0s" for unreported).
 * @param ms Duration in milliseconds, or undefined when unreported.
 * @returns Human-readable duration, or empty when missing.
 */
export function formatSubagentDuration(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
    return "";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)}s`;
  }
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

/**
 * Format live elapsed time from a local start clock (client wall-clock only).
 * Used while status is running and no authoritative durationMs exists.
 * @param startedAtMs Local epoch ms when the card first appeared as running.
 * @param nowMs Current epoch ms (injectable for tests).
 * @returns Formatted elapsed, or empty when start is missing / invalid.
 */
export function formatLiveElapsed(
  startedAtMs: number | undefined,
  nowMs: number = Date.now(),
): string {
  if (
    typeof startedAtMs !== "number" ||
    !Number.isFinite(startedAtMs) ||
    startedAtMs <= 0
  ) {
    return "";
  }
  return formatSubagentDuration(Math.max(0, nowMs - startedAtMs));
}

/**
 * Optional metric fragments for a finished card (tools / turns / tokens).
 * Omits unreported counters so the UI never shows "0 turns" for missing data.
 * @param card Orchestration subagent card.
 * @returns Space-joined metric parts; empty array when nothing reported.
 */
export function subagentMetricParts(card: SubagentCard): string[] {
  const parts: string[] = [];
  if (typeof card.toolCalls === "number") {
    parts.push(`${card.toolCalls} tools`);
  }
  if (typeof card.turns === "number") {
    parts.push(`${card.turns} turns`);
  }
  if (typeof card.tokensUsed === "number") {
    parts.push(formatTokenCount(card.tokensUsed));
  }
  return parts;
}

/**
 * Compact token count for card lines (e.g. 20200 → "20.2k tokens").
 * @param n Token count from the agent.
 * @returns Display string ending in "tokens".
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return "";
  }
  if (n < 1000) {
    return `${Math.round(n)} tokens`;
  }
  const k = n / 1000;
  const text = k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  return `${text} tokens`;
}

/**
 * Normalize a raw status string for UI chips.
 * Known terminals map cleanly; unknown values pass through unchanged.
 * @param status Agent-reported status (running / completed / failed / …).
 * @returns Normalized lowercase status, or the original trimmed string.
 */
export function normalizeSubagentStatus(status: string | undefined): string {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) {
    return "unknown";
  }
  if (s === "running" || s === "in_progress") {
    return "running";
  }
  if (s === "pending") {
    return "pending";
  }
  if (s === "completed" || s === "complete" || s === "done") {
    return "completed";
  }
  if (s === "failed" || s === "error") {
    return "failed";
  }
  if (s === "cancelled" || s === "killed") {
    return s;
  }
  return String(status ?? "").trim() || "unknown";
}

/**
 * One-line summary for a subagent card in the Agents rail list.
 * @param card Orchestration subagent card (camelCase).
 * @returns Display string with role, status, and optional metrics.
 */
export function subagentCardLine(card: SubagentCard): string {
  const status = normalizeSubagentStatus(card.status);
  const parts = [card.description || card.type || card.subagentId, status];
  const duration = formatSubagentDuration(card.durationMs);
  if (duration) {
    parts.push(duration);
  }
  for (const m of subagentMetricParts(card)) {
    parts.push(m);
  }
  return parts.join(" · ");
}

/**
 * One-line summary for a background task card.
 * @param card Orchestration background task card.
 * @returns Display string with label and status.
 */
export function backgroundTaskLine(card: BackgroundTaskCard): string {
  const label = card.description || card.command || card.taskId;
  return `${label} · ${card.status}`;
}

// Backward-compatible aliases used by older imports (orchestrationCards).
export const listOrchestrationSubagentCards = listSubagentCards;
export const listOrchestrationBackgroundTasks = listBackgroundTaskCards;
