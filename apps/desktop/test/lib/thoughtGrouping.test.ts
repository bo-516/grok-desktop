/**
 * Adjacent Thought grouping (shipped thoughtGrouping.ts), mirror of toolGrouping tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupTimelineThoughts,
  sumThoughtDurationMs,
} from "@/lib/thoughtGrouping";
import { groupTimelineTools } from "@/lib/toolGrouping";
import type { TimelineItem } from "@grok-desktop/acp-core";

function thought(
  id: string,
  text: string,
  startedAt: number,
  completedAt: number,
): TimelineItem {
  return {
    kind: "thought",
    id,
    text,
    collapsed: true,
    startedAt,
    completedAt,
  };
}

describe("groupTimelineThoughts", () => {
  it("merges adjacent thoughts and sums totalMs", () => {
    const timeline: TimelineItem[] = [
      thought("th1", "a", 1000, 2000),
      thought("th2", "b", 2000, 4000),
      { kind: "agent", id: "a1", text: "done" },
    ];
    const toolUnits = groupTimelineTools(timeline, {});
    const units = groupTimelineThoughts(toolUnits);
    assert.equal(units.length, 2);
    assert.equal(units[0]?.type, "thought_group");
    if (units[0]?.type === "thought_group") {
      assert.equal(units[0].count, 2);
      assert.equal(units[0].totalMs, 3000);
      assert.deepEqual(units[0].itemIds, ["th1", "th2"]);
      assert.equal(units[0].items[0]?.text, "a");
      assert.equal(units[0].items[1]?.text, "b");
    }
    assert.equal(units[1]?.type, "item");
  });

  it("does not merge thoughts across a tool row", () => {
    const timeline: TimelineItem[] = [
      thought("th1", "before tool", 1000, 2000),
      { kind: "tool", id: "tool-1", toolCallId: "tc-1" },
      thought("th2", "after tool", 3000, 5000),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "read" as const },
    };
    const toolUnits = groupTimelineTools(timeline, tools);
    const units = groupTimelineThoughts(toolUnits);
    assert.equal(units.length, 3);
    assert.equal(units[0]?.type, "item");
    if (units[0]?.type === "item") {
      assert.equal(units[0].item.kind, "thought");
      assert.equal(units[0].item.id, "th1");
    }
    assert.equal(units[1]?.type, "item");
    if (units[1]?.type === "item") {
      assert.equal(units[1].item.kind, "tool");
    }
    assert.equal(units[2]?.type, "item");
    if (units[2]?.type === "item") {
      assert.equal(units[2].item.kind, "thought");
      assert.equal(units[2].item.id, "th2");
    }
  });

  it("leaves a single thought as an item unit (no group of one)", () => {
    const timeline: TimelineItem[] = [
      thought("th1", "only", 1000, 2500),
    ];
    const units = groupTimelineThoughts(groupTimelineTools(timeline, {}));
    assert.equal(units.length, 1);
    assert.equal(units[0]?.type, "item");
  });

  it("sumThoughtDurationMs ignores incomplete segments", () => {
    const items = [
      {
        kind: "thought" as const,
        id: "a",
        text: "x",
        collapsed: true,
        startedAt: 0,
        completedAt: 1000,
      },
      {
        kind: "thought" as const,
        id: "b",
        text: "y",
        collapsed: true,
        startedAt: 1000,
        // still streaming — no completedAt
      },
    ];
    assert.equal(sumThoughtDurationMs(items), 1000);
  });
});
