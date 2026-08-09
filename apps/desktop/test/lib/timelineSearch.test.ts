import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchTimeline, timelineItemText } from "@/lib/timelineSearch";

describe("timelineSearch", () => {
  it("finds agent and user text", () => {
    const hits = searchTimeline(
      [
        {
          kind: "user",
          id: "u1",
          blocks: [{ type: "text", text: "hello world" }],
        },
        { kind: "agent", id: "a1", text: "answer about widgets" },
      ],
      "widget",
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.itemId, "a1");
  });

  it("returns empty for blank query", () => {
    assert.deepEqual(
      searchTimeline([{ kind: "agent", id: "a", text: "x" }], "  "),
      [],
    );
  });

  it("reads user blocks", () => {
    assert.match(
      timelineItemText({
        kind: "user",
        id: "u",
        blocks: [{ type: "text", text: "hi" }],
      }),
      /hi/,
    );
  });
});
