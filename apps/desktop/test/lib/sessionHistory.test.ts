/**
 * Disk transcript → SessionState conversion for cold-open hydrate.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { userTextFromBlocks } from "@grok-desktop/acp-core";
import {
  displayUserText,
  isHarnessContextDump,
  parseSessionHistoryPayload,
  sessionStateFromHistoryPayload,
} from "@/lib/sessionHistory";

const identity = {
  sessionId: "s-hist",
  workspace: "/work",
  title: "Disk chat",
};

describe("displayUserText / harness dumps", () => {
  it("extracts <user_query> and drops user_info packs", () => {
    assert.equal(
      displayUserText("<user_query>\nfocus the input\n</user_query>"),
      "focus the input",
    );
    assert.equal(
      isHarnessContextDump("<user_info>\nOS Version: macos\n</user_info>"),
      true,
    );
    assert.equal(displayUserText("<user_info>\nOS Version: macos\n</user_info>"), "");
  });
});

describe("sessionStateFromHistoryPayload", () => {
  it("prefers chat_history user/agent rows over updates", () => {
    const state = sessionStateFromHistoryPayload(
      {
        sessionId: "s-hist",
        cwd: "/work",
        chatHistory: [
          { type: "system", content: "ignore" },
          {
            type: "user",
            content: [{ type: "text", text: "<user_info>\nno query\n</user_info>" }],
          },
          {
            type: "user",
            content: [
              { type: "text", text: "<user_query>\nreal prompt\n</user_query>" },
            ],
          },
          {
            type: "reasoning",
            summary: [{ type: "summary_text", text: "thinking it through" }],
          },
          {
            type: "assistant",
            content: "I will look.",
            tool_calls: [
              {
                id: "call-1",
                name: "grep",
                arguments: JSON.stringify({ pattern: "focus" }),
              },
            ],
          },
          {
            type: "tool_result",
            tool_call_id: "call-1",
            content: "found it",
          },
        ],
        updates: [
          {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "should not win" },
            },
          },
        ],
      },
      identity,
    );
    const users = state.timeline.filter((item) => item.kind === "user");
    assert.equal(users.length, 1);
    assert.equal(userTextFromBlocks(users[0]!.blocks), "real prompt");
    assert.equal(users[0]!.origin, "seed");
    const agents = state.timeline.filter((item) => item.kind === "agent");
    assert.equal(agents.length, 1);
    assert.equal(agents[0]!.text, "I will look.");
    assert.equal(state.toolCalls["call-1"]?.title, "grep");
    assert.equal(state.toolCalls["call-1"]?.kind, "search");
    assert.equal(state.toolCalls["call-1"]?.status, "completed");
    assert.equal(state.status, "idle");
    assert.equal(state.title, "Disk chat");
    assert.ok(state.timeline.some((item) => item.kind === "thought"));
    assert.ok(state.timeline.some((item) => item.kind === "tool"));
  });

  it("falls back to reducing updates when chat_history is empty", () => {
    const state = sessionStateFromHistoryPayload(
      {
        sessionId: "s-hist",
        cwd: "/work",
        chatHistory: [],
        updates: [
          {
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "hello" },
            },
            eventId: "e1",
          },
          {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hi back" },
            },
            eventId: "e2",
          },
        ],
      },
      identity,
    );
    const users = state.timeline.filter((item) => item.kind === "user");
    assert.ok(users.length >= 1);
    assert.match(userTextFromBlocks(users[0]!.blocks), /hello/);
    assert.equal(state.status, "idle");
  });
});

describe("parseSessionHistoryPayload", () => {
  it("tolerates a missing / malformed bag", () => {
    assert.deepEqual(parseSessionHistoryPayload(null), {
      sessionId: "",
      cwd: "",
      chatHistory: [],
      updates: [],
    });
    const parsed = parseSessionHistoryPayload({
      sessionId: "s1",
      cwd: "/w",
      chatHistory: [{ type: "user" }],
      updates: [{ update: { sessionUpdate: "plan", entries: [] } }],
    });
    assert.equal(parsed.sessionId, "s1");
    assert.equal(parsed.chatHistory.length, 1);
    assert.equal(parsed.updates.length, 1);
  });
});
