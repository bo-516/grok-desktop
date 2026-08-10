/**
 * sessionHasConversationContent lock helper for project switcher.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { sessionHasConversationContent } from "@/lib/sessionContent";

describe("sessionHasConversationContent", () => {
  it("is false for empty or missing timeline", () => {
    assert.equal(sessionHasConversationContent(undefined), false);
    assert.equal(sessionHasConversationContent([]), false);
  });

  it("is true when a user or agent message exists", () => {
    const user: TimelineItem = {
      kind: "user",
      id: "u1",
      blocks: [{ type: "text", text: "hi" }],
    };
    const agent: TimelineItem = {
      kind: "agent",
      id: "a1",
      text: "hello",
    };
    assert.equal(sessionHasConversationContent([user]), true);
    assert.equal(sessionHasConversationContent([agent]), true);
  });

  it("ignores thoughts alone", () => {
    const thought: TimelineItem = {
      kind: "thought",
      id: "t1",
      text: "thinking",
      collapsed: true,
      startedAt: 1,
    };
    assert.equal(sessionHasConversationContent([thought]), false);
  });
});
