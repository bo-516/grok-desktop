/**
 * Pure helpers that map session orchestration maps onto Tasks panel cards.
 * Product path reads `session.subagents` / `session.backgroundTasks` — not
 * tool-call title regex.
 */

import type { BackgroundTaskCard, SubagentCard } from "@grok-desktop/acp-core";

/**
 * List subagent cards in insertion (spawn) order.
 * @param subagents SessionState.subagents map, or undefined when none yet.
 * @returns Array of cards; empty when the map is missing.
 */
export function listOrchestrationSubagentCards(
  subagents: Record<string, SubagentCard> | undefined,
): SubagentCard[] {
  return Object.values(subagents ?? {});
}

/**
 * List background task cards in insertion order.
 * @param backgroundTasks SessionState.backgroundTasks map, or undefined.
 * @returns Array of cards; empty when the map is missing.
 */
export function listOrchestrationBackgroundTasks(
  backgroundTasks: Record<string, BackgroundTaskCard> | undefined,
): BackgroundTaskCard[] {
  return Object.values(backgroundTasks ?? {});
}
