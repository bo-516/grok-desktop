/**
 * timelineContentKey must not throw when wire/hydrate omits lastAgentText
 * or partial agent rows lack text (go-bridge omitempty regression).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { timelineContentKey } from "@/lib/timelineContentKey";

const userItem: TimelineItem = {
  kind: "user",
  id: "u1",
  blocks: [{ type: "text", text: "hi" }],
  origin: "local",
};

const agentItem: TimelineItem = {
  kind: "agent",
  id: "a1",
  text: "hello",
  origin: "agent",
};

describe("timelineContentKey", () => {
  it("returns status-only key for empty timeline", () => {
    assert.equal(timelineContentKey([], "idle", "", ""), "0:idle");
  });

  it("fingerprints agent tail length and buffer", () => {
    assert.equal(
      timelineContentKey([userItem, agentItem], "streaming", "hello", "t1:done"),
      "2:agent:5:streaming:5:t1:done",
    );
  });

  it("treats missing lastAgentText as empty (omitempty hydrate)", () => {
    // Regression: undefined is not an object (evaluating 'n.length')
    assert.equal(
      timelineContentKey([userItem], "idle", undefined, ""),
      "1:user:u1:idle:0:",
    );
    assert.equal(
      timelineContentKey([userItem], "idle", null, ""),
      "1:user:u1:idle:0:",
    );
  });

  it("treats agent row with missing text as length 0", () => {
    const partial = {
      kind: "agent",
      id: "a-partial",
      origin: "agent",
    } as TimelineItem;
    assert.equal(
      timelineContentKey([partial], "streaming", undefined, ""),
      "1:agent:0:streaming:0:",
    );
  });
});
