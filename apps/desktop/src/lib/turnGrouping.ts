/**
 * Collapse one user-prompt span into a single turn: mid-turn agent narration
 * joins the activity rail with thoughts/tools; only the trailing contiguous
 * agent text (with no further work after it) is the answer.
 * Replaces processGrouping: agent narration no longer seals the work shell.
 */

import type { TimelineItem } from "@grok-desktop/acp-core";
import type { TimelineRenderUnitWithThoughts } from "./thoughtGrouping";
import { turnWallDurationMs } from "./turnDuration";

type AgentItem = Extract<TimelineItem, { kind: "agent" }>;

/** Nested unit stored inside a turn activity rail (not a nested turn). */
export type TurnActivityChild = TimelineRenderUnitWithThoughts;

/** Agent text unit used as the final answer bubble. */
export type AgentItemUnit = {
  type: "item";
  item: AgentItem;
};

/**
 * One prompt span: activity rail (process) + optional final answer.
 * Pure-text turns leave activity empty; tool-only ends leave answer undefined.
 */
export type TurnUnit = {
  type: "turn";
  /** Stable React key derived from the first member unit id. */
  id: string;
  /**
   * Activity rail in timeline order: mid-turn agent narration, thoughts, tools.
   * Empty when the turn produced text only (rail is then not rendered).
   */
  activity: TurnActivityChild[];
  /**
   * Final answer: trailing run of agent text with no further work after it.
   * Undefined when the turn ended on tool work / cancel / error.
   */
  answer?: AgentItemUnit;
  /** Rail row count (activity units) for "· N steps". */
  steps: number;
  /** Wall-clock ms for the turn; 0 when no thought clocks exist. */
  totalMs: number;
};

/** Top-level units after turn grouping: user / turn / error (+ residual fallback). */
export type TimelineRenderUnitWithTurns =
  | TurnActivityChild
  | TurnUnit;

/**
 * True when a unit is work or mid-turn narration that belongs inside a turn.
 * User and error rows are turn boundaries (never children).
 * @param unit Output of thought grouping (item / tool_group / thought_group).
 */
export function isTurnMemberUnit(
  unit: TimelineRenderUnitWithThoughts,
): boolean {
  if (unit.type === "tool_group" || unit.type === "thought_group") {
    return true;
  }
  const kind = unit.item.kind;
  return kind === "agent" || kind === "thought" || kind === "tool";
}

/**
 * True when a unit is agent process work (reasoning or tools), not chat text.
 * Used to decide whether a later unit forces earlier agent text into the rail.
 * @param unit Any thought-grouped unit.
 */
export function isWorkUnit(unit: TimelineRenderUnitWithThoughts): boolean {
  if (unit.type === "tool_group" || unit.type === "thought_group") {
    return true;
  }
  return unit.item.kind === "thought" || unit.item.kind === "tool";
}

/**
 * Group thought-grouped units into turns bounded by user / error rows.
 * Within each turn: trailing contiguous agent text becomes answer; everything
 * before that (including agent narration that has later work) is activity.
 * @param units Output of {@link groupTimelineThoughts}.
 * @returns Top-level user / turn / error units (plus rare residual fallbacks).
 */
export function groupTimelineTurns(
  units: TimelineRenderUnitWithThoughts[],
): TimelineRenderUnitWithTurns[] {
  const out: TimelineRenderUnitWithTurns[] = [];
  let i = 0;
  while (i < units.length) {
    const unit = units[i];
    if (unit === undefined) {
      break;
    }
    // User / error seal the previous turn and stay top-level.
    if (unit.type === "item" && (unit.item.kind === "user" || unit.item.kind === "error")) {
      out.push(unit);
      i += 1;
      continue;
    }
    if (!isTurnMemberUnit(unit)) {
      out.push(unit);
      i += 1;
      continue;
    }

    const members: TurnActivityChild[] = [unit];
    let j = i + 1;
    while (j < units.length) {
      const next = units[j];
      if (next === undefined || !isTurnMemberUnit(next)) {
        break;
      }
      members.push(next);
      j += 1;
    }
    out.push(buildTurnUnit(members));
    i = j;
  }
  return out;
}

/**
 * Whether a turn is still the live streaming work block.
 * Live when session is streaming/waiting_permission and no later user row
 * (or later turn) has opened — intervening agent narration does not end live.
 * @param units Full turn-grouped unit list.
 * @param index Index of the turn under test.
 * @param sessionStatus Current session runtime status.
 */
export function isTurnLive(
  units: TimelineRenderUnitWithTurns[],
  index: number,
  sessionStatus: string,
): boolean {
  if (sessionStatus !== "streaming" && sessionStatus !== "waiting_permission") {
    return false;
  }
  for (let i = index + 1; i < units.length; i += 1) {
    const next = units[i];
    if (next === undefined) {
      break;
    }
    if (next.type === "turn") {
      return false;
    }
    if (next.type === "item") {
      const kind = next.item.kind;
      if (kind === "user" || kind === "error") {
        return false;
      }
    }
  }
  return true;
}

// Re-export duration helpers so existing imports from turnGrouping keep working.
export { turnEarliestStartMs, turnWallDurationMs } from "./turnDuration";

/**
 * Split turn members into activity rail + optional trailing answer.
 * Agent unit i belongs to the rail iff a later member is thought/tool work
 * (equivalently: trailing contiguous agents form the answer).
 * @param members Contiguous turn member units between user/error boundaries.
 */
function buildTurnUnit(members: TurnActivityChild[]): TurnUnit {
  // Index of first trailing agent that has no work after it (answer start).
  let answerStart = members.length;
  for (let i = members.length - 1; i >= 0; i -= 1) {
    const member = members[i];
    if (member === undefined) {
      continue;
    }
    if (isAgentItemUnit(member)) {
      answerStart = i;
      continue;
    }
    // Work or non-agent seals the trailing answer run.
    break;
  }

  const trailing = members.slice(answerStart);
  const before = members.slice(0, answerStart);
  const onlyAgents = trailing.every(isAgentItemUnit);
  let activity: TurnActivityChild[];
  let answer: AgentItemUnit | undefined;
  if (onlyAgents && trailing.length > 0) {
    // Last trailing agent is the answer; earlier trailing agents stay as
    // narration only when there was prior work (so pure-text stays rail-free).
    const last = trailing[trailing.length - 1];
    if (last !== undefined && isAgentItemUnit(last)) {
      answer = last;
    }
    if (before.length === 0) {
      // Pure text turn (possibly multi-agent): no rail; only last as answer.
      activity = [];
    } else {
      activity = [...before, ...trailing.slice(0, -1)];
    }
  } else {
    activity = members;
    answer = undefined;
  }

  return {
    type: "turn",
    id: `turn-${memberUnitKey(members[0]!)}`,
    activity,
    answer,
    steps: activity.length,
    totalMs: turnWallDurationMs(activity),
  };
}

/**
 * True when unit is a plain agent text item (not tool/thought).
 * @param unit Candidate member.
 */
function isAgentItemUnit(unit: TurnActivityChild): unit is AgentItemUnit {
  return unit.type === "item" && unit.item.kind === "agent";
}

/**
 * Stable fragment for turn ids.
 * @param unit First member in the run.
 */
function memberUnitKey(unit: TurnActivityChild): string {
  if (unit.type === "item") {
    return unit.item.id;
  }
  return unit.id;
}
