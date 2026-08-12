/**
 * Pure helpers for session-scoped agent / subagent cards.
 * Round grouping, running counts, duration formatting, and list mapping —
 * used by the Agents context rail and L1 inline subagent groups.
 * Replaces orchestrationCards + TasksPanel formatters.
 * Pure — no I/O, no store.
 */

import type { BackgroundTaskCard, SubagentCard } from "@grok-desktop/acp-core";

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
 * Group subagent cards by `parentPromptId` (fan-out round).
 * Cards without a prompt id land in an `"ungrouped"` bucket sorted last.
 * Within a round, insertion order from the map is preserved.
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
