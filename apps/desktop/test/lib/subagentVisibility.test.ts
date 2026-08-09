import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isSubagentToolCard,
  listSubagentCards,
  subagentSummary,
} from "@/lib/subagentVisibility";

describe("subagentVisibility", () => {
  it("detects explore/general-purpose titles", () => {
    assert.equal(
      isSubagentToolCard({ toolCallId: "1", title: "explore: scan repo" }),
      true,
    );
    assert.equal(
      isSubagentToolCard({ toolCallId: "2", title: "read file" }),
      false,
    );
  });

  it("summarizes completed subagent", () => {
    const s = subagentSummary({
      toolCallId: "1",
      title: "spawn_subagent explore",
      status: "completed",
      content: "Found 3 files",
    });
    assert.ok(s);
    assert.match(s!, /Found 3 files/);
  });

  it("lists subagent cards only", () => {
    const list = listSubagentCards({
      a: { toolCallId: "a", title: "explore" },
      b: { toolCallId: "b", title: "edit" },
    });
    assert.equal(list.length, 1);
  });
});
