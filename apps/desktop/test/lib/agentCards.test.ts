/**
 * Pure agent-card helpers for the session-scoped Agents surface.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SubagentCard, ToolCallCard } from "@grok-desktop/acp-core";
import {
  countRunningSubagents,
  formatSubagentDuration,
  groupSubagentsByRound,
  mergeSubagentsWithSpawnTools,
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

/** Vendor meta that identifies a spawn_subagent tool card. */
const SPAWN_META = { "x.ai/tool": { name: "spawn_subagent" } };
/** Vendor meta that identifies a wait-barrier tool card. */
const WAIT_META = { "x.ai/tool": { name: "get_command_or_subagent_output" } };

/**
 * Minimal spawn tool card for merge tests.
 * @param partial Overrides; toolCallId required.
 */
function spawnTool(
  partial: Partial<ToolCallCard> & { toolCallId: string },
): ToolCallCard {
  return {
    kind: "other",
    status: "completed",
    title: partial.title ?? "spawn_subagent",
    meta: SPAWN_META,
    ...partial,
  };
}

describe("mergeSubagentsWithSpawnTools", () => {
  it("builds roster stubs from spawn tools when orchestration is empty", () => {
    const childId = "019ff5e2-b1a1-76f1-a82f-89a7c22e6c9d";
    const merged = mergeSubagentsWithSpawnTools(undefined, {
      "call-1": spawnTool({
        toolCallId: "call-1",
        title: "Shy boyfriend dialogue",
        rawInput: { description: "Shy boyfriend dialogue" },
        content: `Subagent started in background.\nsubagent_id: ${childId}\n`,
      }),
    });
    assert.equal(merged?.[childId]?.description, "Shy boyfriend dialogue");
    assert.equal(merged?.[childId]?.childSessionId, childId);
    assert.equal(merged?.[childId]?.status, "running");
    assert.equal(merged?.[childId]?.toolCallId, "call-1");
  });

  it("does not duplicate a spawn that already has an orchestration card", () => {
    const childId = "019ff5e2-b1a1-76f1-a82f-89a7c22e6c9d";
    const existing: Record<string, SubagentCard> = {
      [childId]: makeCard({
        subagentId: childId,
        description: "from event",
        status: "completed",
        durationMs: 1000,
      }),
    };
    const merged = mergeSubagentsWithSpawnTools(existing, {
      "call-1": spawnTool({
        toolCallId: "call-1",
        rawInput: { description: "from tool" },
        content: `subagent_id: ${childId}`,
      }),
    });
    assert.equal(Object.keys(merged ?? {}).length, 1);
    assert.equal(merged?.[childId]?.description, "from event");
    assert.equal(merged?.[childId]?.status, "completed");
    assert.equal(merged?.[childId]?.durationMs, 1000);
  });

  it("promotes a running stub to completed when the wait barrier finished", () => {
    const childId = "019ff5e2-b1a2-7bf2-a309-286b7a01a200";
    const merged = mergeSubagentsWithSpawnTools(undefined, {
      "call-1": spawnTool({
        toolCallId: "call-1",
        rawInput: { description: "Shy girlfriend dialogue" },
        content: `subagent_id: ${childId}`,
      }),
      "call-wait": {
        toolCallId: "call-wait",
        kind: "other",
        status: "completed",
        title: "multi-wait (wait_all)",
        meta: WAIT_META,
        rawInput: { task_ids: [childId] },
      },
    });
    assert.equal(merged?.[childId]?.status, "completed");
    assert.equal(
      groupSubagentsByRound(merged).reduce((n, r) => n + r.cards.length, 0),
      1,
    );
  });

  it("keeps a pending spawn without a body id as a non-openable stub", () => {
    const merged = mergeSubagentsWithSpawnTools(undefined, {
      "call-pending": spawnTool({
        toolCallId: "call-pending",
        status: "pending",
        rawInput: { description: "not started" },
      }),
    });
    const stub = merged?.["spawn:call-pending"];
    assert.equal(stub?.description, "not started");
    assert.equal(stub?.childSessionId, "");
    assert.equal(stub?.status, "pending");
  });
});
