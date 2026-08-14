/**
 * Per-field catalog merges used by upsertFromLiveState.
 * Isolated so the upsert clock/fingerprint module stays under the line cap.
 */

import {
  mergeTurnUsagePreservingOccupancy,
  type GoalSnapshot,
  type SessionTokenUsage,
  type SubagentCard,
} from "@grok-desktop/acp-core";

/**
 * Max characters of SubagentCard.output kept on catalog rows.
 * Full output is reloadable via child session/load; identity/status stay intact.
 */
export const CATALOG_SUBAGENT_OUTPUT_MAX = 512;

/**
 * Shallow-merge two plain maps; inbound wins on same keys (clientMergeMap).
 * Empty inbound must not clobber a non-empty existing map.
 * @param existing Prior catalog map (may be undefined).
 * @param inbound Live SessionState map (may be undefined/empty).
 * @returns Union map, or undefined when both sides are absent/empty.
 */
export function mergeCatalogMap<T>(
  existing: Record<string, T> | undefined,
  inbound: Record<string, T> | undefined,
): Record<string, T> | undefined {
  const hasExisting = existing && Object.keys(existing).length > 0;
  const hasInbound = inbound && Object.keys(inbound).length > 0;
  if (!hasExisting && !hasInbound) {
    return undefined;
  }
  if (!hasExisting) {
    return inbound;
  }
  if (!hasInbound) {
    return existing;
  }
  return { ...existing, ...inbound };
}

/**
 * Trim subagent card outputs for catalog persistence without dropping cards.
 * @param cards Subagent map from live state or prior catalog.
 * @returns Map with output capped at {@link CATALOG_SUBAGENT_OUTPUT_MAX}.
 */
export function trimSubagentCardsForCatalog(
  cards: Record<string, SubagentCard> | undefined,
): Record<string, SubagentCard> | undefined {
  if (!cards || Object.keys(cards).length === 0) {
    return cards;
  }
  const out: Record<string, SubagentCard> = {};
  for (const [id, card] of Object.entries(cards)) {
    if (
      typeof card.output === "string" &&
      card.output.length > CATALOG_SUBAGENT_OUTPUT_MAX
    ) {
      out[id] = {
        ...card,
        output: card.output.slice(0, CATALOG_SUBAGENT_OUTPUT_MAX),
      };
    } else {
      out[id] = card;
    }
  }
  return out;
}

/**
 * Prefer inbound billed+occupancy; keep catalog occupancy when inbound is empty.
 * Empty Go hydrates must not wipe a ring snapshot the client already painted.
 * @param existing Prior catalog tokenUsage.
 * @param inbound Live SessionState tokenUsage (may be absent).
 * @returns Merged snapshot, or undefined when both sides are empty.
 */
export function mergeCatalogTokenUsage(
  existing: SessionTokenUsage | undefined,
  inbound: SessionTokenUsage | undefined,
): SessionTokenUsage | undefined {
  if (!inbound) {
    return existing;
  }
  if (!existing) {
    return inbound;
  }
  return mergeTurnUsagePreservingOccupancy(inbound, existing);
}

/**
 * Prefer non-empty goal: inbound when present, else existing catalog goal.
 * Thin inbound snapshots (Go hydrate / older catalog rows) may omit
 * `lastEventDetail`; keep the stored worker wrap-up when the goal id matches.
 * @param existing Prior catalog goal.
 * @param inbound Live SessionState goal (may be absent).
 * @returns Goal snapshot for the catalog row, or undefined.
 */
export function mergeCatalogGoal(
  existing: GoalSnapshot | undefined,
  inbound: GoalSnapshot | undefined,
): GoalSnapshot | undefined {
  if (inbound && inbound.goalId) {
    /** Same goal, inbound omitted the wrap-up — keep the catalog copy. */
    const keepDetail =
      !inbound.lastEventDetail &&
      Boolean(existing?.lastEventDetail) &&
      existing?.goalId === inbound.goalId;
    if (keepDetail) {
      return { ...inbound, lastEventDetail: existing?.lastEventDetail };
    }
    return inbound;
  }
  return existing;
}
