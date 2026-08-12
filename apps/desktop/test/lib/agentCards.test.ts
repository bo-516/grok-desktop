/**
 * Pure agent-card helpers for the session-scoped Agents surface.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubagentCard } from "@grok-desktop/acp-core";
import {
  countRunningSubagents,
  formatSubagentDuration,
  groupSubagentsByRound,
  normalizeSubagentStatus,
  subagentMetricParts,
} from "@/lib/agentCards";

/**
 * Minimal subagent card for grouping / count tests.
 * @param partial Fields to override on a running general-purpose card.
 */
function makeCard(
  partial: Partial<SubagentCard> & { subagentId: string },
): SubagentCard {
  return {
    childSessionId: partial.childSessionId ?? partial.subagentId,
    type: "general-purpose",
    description: partial.description ?? partial.subagentId,
    status: "running",
    ...partial,
  };
}

describe("agentCards", () => {
  it("groups by parentPromptId; ungrouped sorts last", () => {
    const subagents: Record<string, SubagentCard> = {
      a: makeCard({
        subagentId: "a",
        parentPromptId: "round-1",
        description: "A",
      }),
      b: makeCard({
        subagentId: "b",
        parentPromptId: "round-1",
        description: "B",
      }),
      c: makeCard({
        subagentId: "c",
        parentPromptId: "round-2",
        description: "C",
      }),
      d: makeCard({
        subagentId: "d",
        description: "orphan",
      }),
    };
    const rounds = groupSubagentsByRound(subagents);
    assert.equal(rounds.length, 3);
    assert.equal(rounds[0]?.parentPromptId, "round-1");
    assert.equal(rounds[0]?.cards.length, 2);
    assert.equal(rounds[1]?.parentPromptId, "round-2");
    assert.equal(rounds[2]?.parentPromptId, "ungrouped");
    assert.equal(rounds[2]?.cards[0]?.subagentId, "d");
  });

  it("countRunningSubagents only counts status === running", () => {
    const subagents: Record<string, SubagentCard> = {
      a: makeCard({ subagentId: "a", status: "running" }),
      b: makeCard({ subagentId: "b", status: "completed" }),
      c: makeCard({ subagentId: "c", status: "failed" }),
      d: makeCard({ subagentId: "d", status: "running" }),
    };
    assert.equal(countRunningSubagents(subagents), 2);
    assert.equal(countRunningSubagents(undefined), 0);
  });

  it("formatSubagentDuration formats real values and hides missing", () => {
    assert.equal(formatSubagentDuration(229663), "3m 50s");
    assert.equal(formatSubagentDuration(undefined), "");
    assert.equal(formatSubagentDuration(NaN), "");
    assert.equal(formatSubagentDuration(-1), "");
  });

  it("unreported counters never show as 0 turns", () => {
    const card = makeCard({ subagentId: "x", status: "completed" });
    assert.deepEqual(subagentMetricParts(card), []);
    const withTurns = makeCard({
      subagentId: "y",
      status: "completed",
      turns: 2,
      toolCalls: 8,
    });
    assert.ok(subagentMetricParts(withTurns).includes("2 turns"));
    assert.ok(subagentMetricParts(withTurns).includes("8 tools"));
  });

  it("normalizeSubagentStatus maps known values; unknown passes through", () => {
    assert.equal(normalizeSubagentStatus("completed"), "completed");
    assert.equal(normalizeSubagentStatus("failed"), "failed");
    assert.equal(normalizeSubagentStatus("running"), "running");
    assert.equal(normalizeSubagentStatus("weird_state"), "weird_state");
  });
});
