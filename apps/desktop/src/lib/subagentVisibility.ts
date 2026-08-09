/**
 * Detect subagent tool calls for parent-session visibility (F-SUB-01/02).
 */

import type { ToolCallCard } from "@grok-desktop/acp-core";

const SUBAGENT_NAME_RE =
  /(subagent|spawn_subagent|explore|general-purpose|general_purpose|\bplan\b)/i;

/**
 * Whether a tool card looks like a subagent invocation.
 * @param card Tool card from agent.
 */
export function isSubagentToolCard(card: ToolCallCard | undefined): boolean {
  if (!card) {
    return false;
  }
  const title = String(card.title ?? "");
  const kind = String(card.kind ?? "");
  return SUBAGENT_NAME_RE.test(title) || SUBAGENT_NAME_RE.test(kind);
}

/**
 * Extract a short summary from a completed subagent tool card for parent UI.
 * @param card Tool card.
 */
export function subagentSummary(card: ToolCallCard | undefined): string | null {
  if (!card || !isSubagentToolCard(card)) {
    return null;
  }
  const title = card.title ?? card.toolCallId;
  const status = card.status ?? "unknown";
  if (typeof card.content === "string" && card.content.trim()) {
    return `${title} (${status}): ${card.content.trim().slice(0, 200)}`;
  }
  return `${title} — ${status}`;
}

/**
 * List subagent cards from the toolCalls map.
 * @param toolCalls Session toolCalls.
 */
export function listSubagentCards(
  toolCalls: Record<string, ToolCallCard>,
): ToolCallCard[] {
  return Object.values(toolCalls).filter((c) => isSubagentToolCard(c));
}
