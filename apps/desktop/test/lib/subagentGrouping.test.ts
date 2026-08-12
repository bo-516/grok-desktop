/**
 * Spawn fan-out grouping for the turn activity rail (L1).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { groupTimelineSubagents } from "@/lib/subagentGrouping";
import { groupTimelineTools } from "@/lib/toolGrouping";
import { groupTimelineThoughts } from "@/lib/thoughtGrouping";
import {
  groupTimelineTurns,
  isTurnMemberUnit,
  isWorkUnit,
} from "@/lib/turnGrouping";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";

const SPAWN_META = {
  "x.ai/tool": { name: "spawn_subagent", kind: "task" },
};
const WAIT_META = {
  "x.ai/tool": { name: "get_command_or_subagent_output" },
};

/**
 * Build a tool timeline item + card pair for grouping fixtures.
 * @param id Tool call id (also used as timeline id suffix).
 * @param meta Vendor meta for identification.
 * @param title Optional human title (must not drive identification).
 */
function spawnPair(
  id: string,
  meta: Record<string, unknown> = SPAWN_META,
  title = "spawn_subagent",
): { item: TimelineItem; card: ToolCallCard } {
  return {
    item: { kind: "tool", id: `tool-${id}`, toolCallId: id },
    card: {
      toolCallId: id,
      title,
      kind: "other",
      status: "completed",
      meta,
    },
  };
}

describe("subagentGrouping", () => {
  it("collapses 4 consecutive spawn cards into one group", () => {
    const pairs = [1, 2, 3, 4].map((n) => spawnPair(`s${n}`));
    const timeline = pairs.map((p) => p.item);
    const toolCalls = Object.fromEntries(
      pairs.map((p) => [p.card.toolCallId, p.card]),
    );
    const units = groupTimelineSubagents(
      groupTimelineTools(timeline, toolCalls),
      toolCalls,
    );
    assert.equal(units.length, 1);
    assert.equal(units[0]?.type, "subagent_group");
    if (units[0]?.type === "subagent_group") {
      assert.equal(units[0].toolCallIds.length, 4);
      assert.deepEqual(units[0].toolCallIds, ["s1", "s2", "s3", "s4"]);
      assert.equal(units[0].waitToolCallId, undefined);
    }
  });

  it("absorbs a trailing wait barrier into the group", () => {
    const pairs = [1, 2].map((n) => spawnPair(`s${n}`));
    const wait = spawnPair("wait-1", WAIT_META, "multi-wait (wait_all)");
    const timeline = [...pairs.map((p) => p.item), wait.item];
    const toolCalls = Object.fromEntries(
      [...pairs, wait].map((p) => [p.card.toolCallId, p.card]),
    );
    const units = groupTimelineSubagents(
      groupTimelineTools(timeline, toolCalls),
      toolCalls,
    );
    assert.equal(units.length, 1);
    assert.equal(units[0]?.type, "subagent_group");
    if (units[0]?.type === "subagent_group") {
      assert.deepEqual(units[0].toolCallIds, ["s1", "s2"]);
      assert.equal(units[0].waitToolCallId, "wait-1");
    }
  });

  it("splits groups when a non-spawn tool interrupts", () => {
    const a = spawnPair("s1");
    const mid: { item: TimelineItem; card: ToolCallCard } = {
      item: { kind: "tool", id: "tool-read", toolCallId: "read-1" },
      card: {
        toolCallId: "read-1",
        title: "Read file",
        kind: "read",
        status: "completed",
      },
    };
    const b = spawnPair("s2");
    const timeline = [a.item, mid.item, b.item];
    const toolCalls = {
      [a.card.toolCallId]: a.card,
      [mid.card.toolCallId]: mid.card,
      [b.card.toolCallId]: b.card,
    };
    const units = groupTimelineSubagents(
      groupTimelineTools(timeline, toolCalls),
      toolCalls,
    );
    const groups = units.filter((u) => u.type === "subagent_group");
    assert.equal(groups.length, 2);
  });

  it("still groups when there is no wait barrier", () => {
    const pairs = [1, 2, 3].map((n) => spawnPair(`s${n}`));
    const timeline = pairs.map((p) => p.item);
    const toolCalls = Object.fromEntries(
      pairs.map((p) => [p.card.toolCallId, p.card]),
    );
    const units = groupTimelineSubagents(
      groupTimelineTools(timeline, toolCalls),
      toolCalls,
    );
    assert.equal(units[0]?.type, "subagent_group");
    if (units[0]?.type === "subagent_group") {
      assert.equal(units[0].waitToolCallId, undefined);
    }
  });

  it("does not swallow spawn cards into a generic tool_group", () => {
    const pairs = [1, 2].map((n) => spawnPair(`s${n}`));
    const timeline = pairs.map((p) => p.item);
    const toolCalls = Object.fromEntries(
      pairs.map((p) => [p.card.toolCallId, p.card]),
    );
    const afterTools = groupTimelineTools(timeline, toolCalls);
    assert.ok(afterTools.every((u) => u.type === "item"));
    const afterSub = groupTimelineSubagents(afterTools, toolCalls);
    assert.equal(afterSub.length, 1);
    assert.equal(afterSub[0]?.type, "subagent_group");
  });

  it("keeps one turn when a subagent_group sits between user and answer", () => {
    const pairs = [1, 2].map((n) => spawnPair(`s${n}`));
    const timeline: TimelineItem[] = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "fan out" }],
      },
      ...pairs.map((p) => p.item),
      { kind: "agent", id: "a1", text: "done" },
    ];
    const toolCalls = Object.fromEntries(
      pairs.map((p) => [p.card.toolCallId, p.card]),
    );
    const units = buildTimelineRenderUnits(timeline, toolCalls);
    const turns = units.filter((u) => u.type === "turn");
    assert.equal(turns.length, 1);
    if (turns[0]?.type === "turn") {
      assert.ok(
        turns[0].activity.some((c) => c.type === "subagent_group"),
        "activity should contain subagent_group",
      );
    }
  });

  it("isTurnMemberUnit / isWorkUnit treat subagent_group as work", () => {
    const unit = {
      type: "subagent_group" as const,
      id: "subagent-group-x",
      toolCallIds: ["s1"],
    };
    assert.equal(isTurnMemberUnit(unit), true);
    assert.equal(isWorkUnit(unit), true);
    // groupTimelineThoughts must pass the unit through.
    const afterThoughts = groupTimelineThoughts([unit]);
    assert.equal(afterThoughts.length, 1);
    assert.equal(afterThoughts[0]?.type, "subagent_group");
    const afterTurns = groupTimelineTurns(afterThoughts);
    assert.equal(afterTurns.length, 1);
    assert.equal(afterTurns[0]?.type, "turn");
  });
});
