/**
 * Turn grouping (shipped turnGrouping.ts) — one prompt span = one turn.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTurnLive,
  turnWallDurationMs,
} from "@/lib/turnGrouping";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import type { TimelineItem } from "@grok-desktop/acp-core";

function thought(
  id: string,
  text: string,
  startedAt: number,
  completedAt?: number,
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

function agent(id: string, text: string): TimelineItem {
  return { kind: "agent", id, text };
}

function tool(id: string, toolCallId: string): TimelineItem {
  return { kind: "tool", id, toolCallId };
}

/** Product grouping compose — same entry as TimelineWidget / changeSet. */
function pipeline(timeline: TimelineItem[], toolCalls = {}) {
  return buildTimelineRenderUnits(timeline, toolCalls);
}

describe("groupTimelineTurns", () => {
  it("agent → tool → agent yields one turn with narration + tool in activity", () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u1", blocks: [{ type: "text", text: "hi" }] },
      agent("a1", "Looking at composer…"),
      tool("t1", "tc-1"),
      agent("a2", "Final answer."),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "execute" as const },
    };
    const units = pipeline(timeline, tools);
    assert.equal(units.length, 2);
    assert.equal(units[0]?.type, "item");
    assert.equal(units[1]?.type, "turn");
    if (units[1]?.type === "turn") {
      assert.equal(units[1].activity.length, 2);
      assert.equal(units[1].steps, 2);
      assert.ok(units[1].answer);
      assert.equal(units[1].answer?.item.id, "a2");
      assert.equal(units[1].answer?.item.text, "Final answer.");
      // First activity is mid-turn narration.
      const first = units[1].activity[0];
      assert.equal(first?.type, "item");
      if (first?.type === "item") {
        assert.equal(first.item.kind, "agent");
        assert.equal(first.item.id, "a1");
      }
    }
  });

  it("agent → tool → agent → tool → agent is one turn (screenshot path)", () => {
    const timeline: TimelineItem[] = [
      agent("a1", "Looking…"),
      tool("t1", "tc-1"),
      agent("a2", "There's already…"),
      tool("t2", "tc-2"),
      agent("a3", "Implementing…"),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "execute" as const },
      "tc-2": { toolCallId: "tc-2", kind: "execute" as const },
    };
    const units = pipeline(timeline, tools);
    assert.equal(units.length, 1);
    assert.equal(units[0]?.type, "turn");
    if (units[0]?.type === "turn") {
      assert.equal(units[0].activity.length, 4);
      assert.equal(units[0].steps, 4);
      assert.equal(units[0].answer?.item.id, "a3");
    }
  });

  it("pure text turn has empty activity and an answer (no rail)", () => {
    const units = pipeline([agent("a1", "Just text.")]);
    assert.equal(units.length, 1);
    assert.equal(units[0]?.type, "turn");
    if (units[0]?.type === "turn") {
      assert.equal(units[0].activity.length, 0);
      assert.equal(units[0].steps, 0);
      assert.equal(units[0].answer?.item.text, "Just text.");
    }
  });

  it("tool-only end leaves answer undefined", () => {
    const timeline: TimelineItem[] = [
      agent("a1", "Will run a tool"),
      tool("t1", "tc-1"),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "execute" as const },
    };
    const units = pipeline(timeline, tools);
    assert.equal(units.length, 1);
    if (units[0]?.type === "turn") {
      assert.equal(units[0].answer, undefined);
      assert.ok(units[0].activity.length >= 1);
    }
  });

  it("user row cuts turns — two users yield two turns", () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u1", blocks: [{ type: "text", text: "one" }] },
      agent("a1", "first answer"),
      { kind: "user", id: "u2", blocks: [{ type: "text", text: "two" }] },
      agent("a2", "second answer"),
    ];
    const units = pipeline(timeline);
    assert.equal(units.length, 4);
    assert.equal(units[0]?.type, "item");
    assert.equal(units[1]?.type, "turn");
    assert.equal(units[2]?.type, "item");
    assert.equal(units[3]?.type, "turn");
    if (units[1]?.type === "turn" && units[3]?.type === "turn") {
      assert.equal(units[1].answer?.item.id, "a1");
      assert.equal(units[3].answer?.item.id, "a2");
    }
  });

  it("error is top-level and seals the rail (not inside activity)", () => {
    const timeline: TimelineItem[] = [
      agent("a1", "mid"),
      tool("t1", "tc-1"),
      { kind: "error", id: "e1", message: "boom" },
      agent("a2", "after error"),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "execute" as const },
    };
    const units = pipeline(timeline, tools);
    assert.equal(units.length, 3);
    assert.equal(units[0]?.type, "turn");
    assert.equal(units[1]?.type, "item");
    if (units[1]?.type === "item") {
      assert.equal(units[1].item.kind, "error");
    }
    assert.equal(units[2]?.type, "turn");
    if (units[0]?.type === "turn") {
      // Error never lands in activity.
      for (const child of units[0].activity) {
        if (child.type === "item") {
          assert.notEqual(child.item.kind, "error");
        }
      }
    }
  });

  it("thought + tool wall duration spans earliest start to latest complete", () => {
    const timeline: TimelineItem[] = [
      thought("th1", "plan", 1000, 2000),
      tool("tool-1", "tc-1"),
      thought("th2", "after", 10_000, 13_000),
      agent("a1", "done"),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "execute" as const },
    };
    const units = pipeline(timeline, tools);
    assert.equal(units[0]?.type, "turn");
    if (units[0]?.type === "turn") {
      assert.equal(units[0].totalMs, 12_000);
    }
  });

  it("merges adjacent thought_group + tool_group into one turn activity", () => {
    const timeline: TimelineItem[] = [
      thought("th1", "a", 1000, 2000),
      thought("th2", "b", 2000, 3000),
      tool("t1", "r1"),
      tool("t2", "r2"),
    ];
    const tools = {
      r1: { toolCallId: "r1", kind: "read" as const },
      r2: { toolCallId: "r2", kind: "search" as const },
    };
    const units = pipeline(timeline, tools);
    assert.equal(units.length, 1);
    if (units[0]?.type === "turn") {
      assert.equal(units[0].answer, undefined);
      assert.equal(units[0].activity.length, 2);
      assert.equal(units[0].activity[0]?.type, "thought_group");
      assert.equal(units[0].activity[1]?.type, "tool_group");
      assert.equal(units[0].totalMs, 2000);
    }
  });
});

describe("isTurnLive", () => {
  it("stays live when mid-turn agent narration appears while streaming", () => {
    const units = pipeline([
      agent("a1", "narration"),
      tool("t1", "tc-1"),
      agent("a2", "more narration"),
    ], {
      "tc-1": { toolCallId: "tc-1", kind: "execute" as const },
    });
    // Single turn still streaming — agent text does not end live.
    assert.equal(units.length, 1);
    assert.equal(isTurnLive(units, 0, "streaming"), true);
    assert.equal(isTurnLive(units, 0, "waiting_permission"), true);
    assert.equal(isTurnLive(units, 0, "idle"), false);
  });

  it("is not live after a following user row", () => {
    const units = pipeline([
      agent("a1", "first"),
      { kind: "user", id: "u2", blocks: [{ type: "text", text: "next" }] },
      agent("a2", "second"),
    ]);
    assert.equal(isTurnLive(units, 0, "streaming"), false);
    // Second turn (index 2) is the live one.
    assert.equal(isTurnLive(units, 2, "streaming"), true);
  });
});

describe("turnWallDurationMs", () => {
  it("returns 0 when no thought timestamps exist", () => {
    assert.equal(
      turnWallDurationMs([
        { type: "item", item: { kind: "tool", id: "t", toolCallId: "c" } },
      ]),
      0,
    );
  });
});
