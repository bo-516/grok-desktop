/**
 * Collapse consecutive spawn_subagent tool cards into one `subagent_group`
 * unit for the turn activity rail (L1 inline visibility).
 *
 * Pipeline position: AFTER {@link groupTimelineTools}, BEFORE
 * {@link groupTimelineThoughts}. Spawn cards use ACP kind `"other"`, which
 * `isCollapsibleToolKind` does not collapse — so they arrive here as bare
 * `{ type: "item", item: tool }`. If `"other"` is ever added to the
 * collapsible set, this pass would silently stop grouping fan-outs.
 *
 * Grouping is by adjacency, not by `parentPromptId`: the timeline has no
 * prompt id on rows, and observed emission is always a contiguous run of
 * spawn cards. A non-spawn card between two spawns starts a new group.
 * Pure — no I/O.
 */

import {
  isSpawnSubagentCard,
  isWaitSubagentCard,
  type ToolCallCard,
} from "@grok-desktop/acp-core";
import type { TimelineRenderUnit } from "./toolGrouping";

/** Fan-out unit: consecutive spawn cards plus the wait barrier that joins them. */
export type SubagentGroupUnit = {
  type: "subagent_group";
  /** Stable key from the first spawn card's timeline item id. */
  id: string;
  /** Spawn card ids in timeline order (= agent's declared fan-out order). */
  toolCallIds: string[];
  /**
   * Wait-barrier card id when the agent blocked on these tasks in the same
   * turn; undefined for fire-and-forget fan-out (the group then has no join row).
   */
  waitToolCallId?: string;
};

/** Tool-grouped units plus the new fan-out unit. */
export type SubagentTimelineUnit = TimelineRenderUnit | SubagentGroupUnit;

/**
 * Collapse a spawn fan-out into one group unit.
 *
 * @param units Output of {@link groupTimelineTools}.
 * @param toolCalls Card map for vendor-name lookup (`_meta["x.ai/tool"].name`).
 * @returns Units where spawn runs are replaced by one `subagent_group` each;
 *   non-spawn units pass through unchanged.
 */
export function groupTimelineSubagents(
  units: TimelineRenderUnit[],
  toolCalls: Record<string, ToolCallCard | undefined>,
): SubagentTimelineUnit[] {
  const out: SubagentTimelineUnit[] = [];
  let i = 0;
  while (i < units.length) {
    const unit = units[i];
    if (unit === undefined) {
      break;
    }
    if (!isSpawnItemUnit(unit, toolCalls)) {
      out.push(unit);
      i += 1;
      continue;
    }

    const toolCallIds: string[] = [unit.item.toolCallId];
    let j = i + 1;
    while (j < units.length) {
      const next = units[j];
      if (next === undefined || !isSpawnItemUnit(next, toolCalls)) {
        break;
      }
      toolCallIds.push(next.item.toolCallId);
      j += 1;
    }

    // Absorb a trailing wait barrier when it immediately follows the run.
    let waitToolCallId: string | undefined;
    const after = units[j];
    if (after !== undefined && isWaitItemUnit(after, toolCalls)) {
      waitToolCallId = after.item.toolCallId;
      j += 1;
    }

    out.push({
      type: "subagent_group",
      id: `subagent-group-${unit.item.id}`,
      toolCallIds,
      waitToolCallId,
    });
    i = j;
  }
  return out;
}

/**
 * True when unit is a bare tool item whose vendor name is spawn_subagent.
 * @param unit Candidate from tool grouping.
 * @param toolCalls Card map for meta lookup.
 */
function isSpawnItemUnit(
  unit: TimelineRenderUnit,
  toolCalls: Record<string, ToolCallCard | undefined>,
): unit is { type: "item"; item: { kind: "tool"; id: string; toolCallId: string } } {
  if (unit.type !== "item" || unit.item.kind !== "tool") {
    return false;
  }
  return isSpawnSubagentCard(toolCalls[unit.item.toolCallId]);
}

/**
 * True when unit is a bare tool item whose vendor name is the wait barrier.
 * @param unit Candidate from tool grouping.
 * @param toolCalls Card map for meta lookup.
 */
function isWaitItemUnit(
  unit: TimelineRenderUnit,
  toolCalls: Record<string, ToolCallCard | undefined>,
): unit is { type: "item"; item: { kind: "tool"; id: string; toolCallId: string } } {
  if (unit.type !== "item" || unit.item.kind !== "tool") {
    return false;
  }
  return isWaitSubagentCard(toolCalls[unit.item.toolCallId]);
}
