/**
 * Timeline reducer + tool patch-merge tests against real applySessionUpdate.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
  extractSessionUpdate,
  patchToolCard,
  resetTimelineIdCounter,
} from "../src/timeline.js";
import {
  appendUserPrompt,
  buildPermissionOutcome,
  clearPendingPermission,
  markDisconnected,
  markPromptSettled,
  markPromptStarted,
  setPendingPermission,
  shapePermissionRequest,
  transitionStatus,
} from "../src/sessionLifecycle.js";
import { normalizeAvailableCommands } from "../src/sessionMetadata.js";

describe("timeline / tool patch-merge", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("patchToolCard status-only does not wipe content", () => {
    const existing = {
      toolCallId: "t1",
      title: "edit foo.ts",
      kind: "edit",
      status: "pending",
      content: {
        type: "diff",
        path: "foo.ts",
        oldText: "a",
        newText: "b",
      },
    };
    const patched = patchToolCard(existing, {
      toolCallId: "t1",
      status: "completed",
    });
    assert.equal(patched.status, "completed");
    assert.deepEqual(patched.content, existing.content);
    assert.equal(patched.title, "edit foo.ts");
  });

  it("applySessionUpdate tool_call then status-only tool_call_update preserves content", () => {
    let state = createSessionState({ id: "s1", workspace: "/tmp/proj" });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      title: "read main.ts",
      kind: "read",
      status: "pending",
      content: { body: "file contents here" },
    });
    assert.equal(state.timeline.some((t) => t.kind === "tool"), true);
    assert.deepEqual(state.toolCalls["tc-1"]?.content, {
      body: "file contents here",
    });

    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "completed",
    });
    assert.equal(state.toolCalls["tc-1"]?.status, "completed");
    assert.deepEqual(state.toolCalls["tc-1"]?.content, {
      body: "file contents here",
    });
    // still one timeline pointer
    assert.equal(
      state.timeline.filter((t) => t.kind === "tool").length,
      1,
    );
  });

  it("agent_message_chunk streams into one agent item and lastAgentText", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "Hello " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "world" },
    });
    assert.equal(state.timeline.length, 1);
    assert.equal(state.timeline[0]?.kind, "agent");
    if (state.timeline[0]?.kind === "agent") {
      assert.equal(state.timeline[0].text, "Hello world");
    }
    assert.equal(state.lastAgentText, "Hello world");
    assert.equal(state.status, "streaming");
  });

  it("thought chunks merge into collapsed thought item", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "think " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "more" },
    });
    assert.equal(state.timeline[0]?.kind, "thought");
    if (state.timeline[0]?.kind === "thought") {
      assert.equal(state.timeline[0].text, "think more");
      assert.equal(state.timeline[0].collapsed, true);
    }
  });

  it("completes Thinking when the agent starts its visible answer", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "plan response" },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "done" },
    });

    const thought = state.timeline[0];
    assert.equal(thought?.kind, "thought");
    if (thought?.kind === "thought") {
      assert.equal(typeof thought.startedAt, "number");
      assert.equal(typeof thought.completedAt, "number");
    }

    state = markPromptSettled(state);
    assert.equal(state.status, "idle");
  });

  it("plan replaces entire plan list", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [{ content: "A", status: "pending" }],
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "plan",
      entries: [
        { content: "A", status: "completed" },
        { content: "B", status: "in_progress" },
      ],
    });
    assert.equal(state.plan?.length, 2);
    assert.equal(state.plan?.[1]?.content, "B");
  });

  it("extractSessionUpdate reads nested update field", () => {
    const u = extractSessionUpdate({
      sessionId: "s",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { text: "x" },
      },
    });
    assert.equal(u?.sessionUpdate, "agent_message_chunk");
  });

  it("permission shaping defaults four options and buildPermissionOutcome", () => {
    const req = shapePermissionRequest(9, {
      toolCall: { toolCallId: "t", title: "run ls", kind: "execute" },
    });
    assert.equal(req.requestId, 9);
    assert.equal(req.options?.length, 4);
    assert.equal(req.toolCall?.title, "run ls");
    const outcome = buildPermissionOutcome("allow_once");
    assert.deepEqual(outcome, {
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  it("status transitions: streaming → waiting_permission → streaming → idle path", () => {
    let state = createSessionState({ id: "s1" });
    state = markPromptStarted(state);
    assert.equal(state.status, "streaming");
    state = setPendingPermission(state, shapePermissionRequest(1, {}));
    assert.equal(state.status, "waiting_permission");
    state = clearPendingPermission(state, "streaming");
    assert.equal(state.status, "streaming");
    assert.equal(state.pendingPermission, undefined);
    state = markDisconnected(state);
    assert.equal(state.status, "disconnected");
  });

  it("appendUserPrompt adds user blocks and sets streaming", () => {
    let state = createSessionState({ id: "s1" });
    state = appendUserPrompt(state, [{ type: "text", text: "hi" }]);
    assert.equal(state.timeline[0]?.kind, "user");
    assert.equal(state.status, "streaming");
  });

  it("user_message_chunk does not duplicate optimistic appendUserPrompt text", () => {
    let state = createSessionState({ id: "s1" });
    state = appendUserPrompt(state, [
      { type: "text", text: "Introduce demo in one sentence" },
    ]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "Introduce demo in one sentence" },
    });
    const user = state.timeline.find((item) => item.kind === "user");
    assert.ok(user && user.kind === "user");
    if (user && user.kind === "user") {
      const text = user.blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      assert.equal(text, "Introduce demo in one sentence");
      assert.notEqual(
        text,
        "Introduce demo in one sentenceIntroduce demo in one sentence",
      );
    }
  });

  it("user_message_chunk can extend a shorter optimistic prefix", () => {
    let state = createSessionState({ id: "s1" });
    state = appendUserPrompt(state, [{ type: "text", text: "hello" }]);
    state = applySessionUpdate(state, {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "hello world" },
    });
    const user = state.timeline.find((item) => item.kind === "user");
    assert.ok(user && user.kind === "user");
    if (user && user.kind === "user") {
      const text = user.blocks
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("");
      assert.equal(text, "hello world");
    }
  });

  it("transitionStatus returns next status", () => {
    assert.equal(transitionStatus("idle", "streaming"), "streaming");
    assert.equal(
      transitionStatus("streaming", "waiting_permission"),
      "waiting_permission",
    );
  });

  it("session_info_update sets title without timeline error row", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      title: "  Fix login bug  ",
    });
    assert.equal(state.title, "Fix login bug");
    assert.equal(state.timeline.length, 0);

    // Partial update without title field leaves title alone
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      updatedAt: "2026-08-07T00:00:00Z",
    });
    assert.equal(state.title, "Fix login bug");
    assert.equal(state.updatedAt, "2026-08-07T00:00:00Z");

    // null clears title
    state = applySessionUpdate(state, {
      sessionUpdate: "session_info_update",
      title: null,
    });
    assert.equal(state.title, undefined);
  });

  it("config_option_update stores options without timeline noise", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "config_option_update",
      configOptions: [{ id: "model", currentValue: "grok" }],
    });
    assert.equal(state.configOptions?.length, 1);
    assert.equal(state.timeline.length, 0);
  });

  it("normalizes real command metadata before it reaches the composer", () => {
    const commands = normalizeAvailableCommands([
      {
        name: "review",
        description: "Run a review",
        input: { hint: "[--local]" },
        _meta: { scope: "bundled" },
      },
      { name: "review", description: "duplicate" },
      { name: 42 },
    ]);

    assert.deepEqual(commands, [
      {
        name: "review",
        description: "Run a review",
        input: { hint: "[--local]" },
        _meta: { scope: "bundled" },
      },
    ]);
  });
});
