/**
 * Product timeline grouping compose — single entry for UI + change-set index.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import type { TimelineItem } from "@grok-desktop/acp-core";

describe("buildTimelineRenderUnits", () => {
  it("composes tools → thoughts → turns into one turn per user span", () => {
    const timeline: TimelineItem[] = [
      { kind: "user", id: "u1", blocks: [{ type: "text", text: "hi" }] },
      { kind: "agent", id: "a1", text: "Looking…" },
      { kind: "tool", id: "t1", toolCallId: "tc1" },
      { kind: "agent", id: "a2", text: "Done." },
    ];
    const units = buildTimelineRenderUnits(timeline, {
      tc1: {
        toolCallId: "tc1",
        title: "read",
        kind: "read",
        status: "completed",
      },
    });
    assert.equal(units.length, 2);
    assert.equal(units[0]?.type, "item");
    if (units[0]?.type === "item") {
      assert.equal(units[0].item.kind, "user");
    }
    assert.equal(units[1]?.type, "turn");
    if (units[1]?.type === "turn") {
      assert.ok(units[1].activity.length >= 1);
      assert.equal(units[1].answer?.item.id, "a2");
    }
  });

  it("returns empty array for empty timeline", () => {
    assert.deepEqual(buildTimelineRenderUnits([], {}), []);
  });
});
