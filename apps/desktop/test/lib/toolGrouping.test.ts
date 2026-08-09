import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupTimelineTools, toolGroupSummary } from "@/lib/toolGrouping";

describe("toolGrouping", () => {
  it("collapses consecutive read/search tools", () => {
    const timeline = [
      { kind: "tool" as const, id: "t1", toolCallId: "a" },
      { kind: "tool" as const, id: "t2", toolCallId: "b" },
      { kind: "tool" as const, id: "t3", toolCallId: "c" },
      { kind: "agent" as const, id: "a1", text: "done" },
    ];
    const tools = {
      a: { toolCallId: "a", kind: "read" },
      b: { toolCallId: "b", kind: "search" },
      c: { toolCallId: "c", kind: "read" },
    };
    const units = groupTimelineTools(timeline, tools);
    assert.equal(units.length, 2);
    assert.equal(units[0]?.type, "tool_group");
    if (units[0]?.type === "tool_group") {
      assert.equal(units[0].count, 3);
    }
    assert.equal(units[1]?.type, "item");
  });

  it("does not collapse edit tools", () => {
    const timeline = [
      { kind: "tool" as const, id: "t1", toolCallId: "a" },
      { kind: "tool" as const, id: "t2", toolCallId: "b" },
    ];
    const tools = {
      a: { toolCallId: "a", kind: "edit" },
      b: { toolCallId: "b", kind: "edit" },
    };
    const units = groupTimelineTools(timeline, tools);
    assert.equal(units.length, 2);
    assert.ok(units.every((u) => u.type === "item"));
  });

  it("summarizes group label", () => {
    assert.match(toolGroupSummary(["read", "search"], 5), /5/);
  });
});
