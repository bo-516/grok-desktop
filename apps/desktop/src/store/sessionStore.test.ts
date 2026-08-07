/**
 * Desktop store helpers must call real acp-core patch-merge path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
} from "@grok-desktop/acp-core";
import { applyToolFixtureThroughCore } from "./sessionStore";

describe("sessionStore shared patch-merge path", () => {
  it("applyToolFixtureThroughCore uses production applySessionUpdate", () => {
    const base = createSessionState({ id: "ui-1", workspace: "/w" });
    const next = applyToolFixtureThroughCore(base, [
      {
        sessionUpdate: "tool_call",
        toolCallId: "u1",
        title: "edit a.ts",
        kind: "edit",
        status: "pending",
        content: { type: "diff", path: "a.ts", oldText: "x", newText: "y" },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "u1",
        status: "completed",
      },
    ]);

    // Same result as calling applySessionUpdate twice directly
    let direct = createSessionState({ id: "ui-1", workspace: "/w" });
    direct = applySessionUpdate(direct, {
      sessionUpdate: "tool_call",
      toolCallId: "u1",
      title: "edit a.ts",
      kind: "edit",
      status: "pending",
      content: { type: "diff", path: "a.ts", oldText: "x", newText: "y" },
    });
    direct = applySessionUpdate(direct, {
      sessionUpdate: "tool_call_update",
      toolCallId: "u1",
      status: "completed",
    });

    assert.equal(next.toolCalls.u1?.status, "completed");
    assert.deepEqual(next.toolCalls.u1?.content, direct.toolCalls.u1?.content);
    assert.deepEqual(next.toolCalls.u1?.content, {
      type: "diff",
      path: "a.ts",
      oldText: "x",
      newText: "y",
    });
  });
});
