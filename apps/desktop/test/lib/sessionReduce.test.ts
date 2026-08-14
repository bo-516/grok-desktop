/**
 * Client-side relay reduce: real applySessionUpdate + eventId set dedupe.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  resetTimelineIdCounter,
} from "@grok-desktop/acp-core";
import {
  applySessionLifecycle,
  createSessionReduceBucket,
  hydrateSessionBucket,
  reduceSessionUpdate,
  replayEndCanvasStatus,
} from "@/lib/sessionReduce";

describe("sessionReduce (relay path)", () => {
  it("applies ordered updates and dedupes by eventId", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket(
      createSessionState({ id: "s1", workspace: "/w" }),
    );

    const first = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi" },
      },
      "s1-1",
    );
    assert.equal(first.lastAgentText, "Hi");

    const dup = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi" },
      },
      "s1-1",
    );
    assert.equal(dup.lastAgentText, "Hi");
    assert.equal(dup.timeline.filter((t) => t.kind === "agent").length, 1);

    const second = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "!" },
      },
      "s1-2",
    );
    assert.equal(second.lastAgentText, "Hi!");
  });

  it("keeps reordered tool_call_update after task_* eventIds", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket(
      createSessionState({ id: "sid", workspace: "/demo" }),
    );

    reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "cmd",
        kind: "execute",
        status: "pending",
      },
      "sid-10",
    );
    // Non-monotonic: higher seq task_* before lower-seq tool update
    reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "task_backgrounded",
        taskId: "bg1",
        toolCallId: "t1",
        command: "echo",
        status: "running",
      } as Parameters<typeof reduceSessionUpdate>[1],
      "sid-12",
    );
    const after = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      },
      "sid-11",
    );

    assert.equal(after.toolCalls.t1?.status, "completed");
    // Watermark-style would have dropped sid-11; set-dedupe keeps it.
    const dropped = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "failed",
      },
      "sid-11",
    );
    assert.equal(dropped.toolCalls.t1?.status, "completed");
  });

  it("hydrate ownership-merges state and lifecycle patches status", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket();
    hydrateSessionBucket(
      bucket,
      createSessionState({ id: "h1", workspace: "/x" }),
      { clearDedupe: true },
    );
    assert.equal(bucket.state.id, "h1");

    const next = applySessionLifecycle(bucket, {
      status: "streaming",
      pendingPermission: null,
    });
    assert.equal(next.status, "streaming");
  });

  it("replayEndCanvasStatus idles streaming residue and keeps permission", () => {
    assert.equal(replayEndCanvasStatus("streaming"), "idle");
    assert.equal(replayEndCanvasStatus("idle"), "idle");
    assert.equal(replayEndCanvasStatus("disconnected"), "idle");
    assert.equal(replayEndCanvasStatus("waiting_permission"), "waiting_permission");
  });

  it("default hydrate keeps client subagents; replace wipes them", () => {
    resetTimelineIdCounter();
    const seeded = createSessionState({ id: "p", workspace: "/w" });
    seeded.subagents = {
      a1: {
        subagentId: "a1",
        childSessionId: "c1",
        type: "general-purpose",
        description: "worker",
        status: "running",
      },
    };
    const bucket = createSessionReduceBucket(seeded);
    const empty = createSessionState({ id: "p", workspace: "/w" });
    empty.timeline = [];
    hydrateSessionBucket(bucket, empty);
    assert.equal(Object.keys(bucket.state.subagents ?? {}).length, 1);

    hydrateSessionBucket(bucket, empty, { replace: true });
    assert.equal(Object.keys(bucket.state.subagents ?? {}).length, 0);
  });

  it("clearDedupe false keeps the eventId ring across an empty hydrate", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket(
      createSessionState({ id: "s1", workspace: "/w" }),
    );
    reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi" },
      },
      "keep-1",
    );
    assert.equal(bucket.dedupe.size, 1);
    hydrateSessionBucket(
      bucket,
      createSessionState({ id: "s1", workspace: "/w" }),
      { clearDedupe: false },
    );
    assert.equal(bucket.dedupe.size, 1);
    const dup = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hi" },
      },
      "keep-1",
    );
    assert.equal(dup.lastAgentText, "Hi");
  });

  it("empty Go hydrate does not wipe available_commands_update catalog", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket(
      createSessionState({ id: "s1", workspace: "/w" }),
    );
    reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "available_commands_update",
        availableCommands: [
          { name: "compact", description: "Compress conversation history" },
          { name: "context", description: "Show context window usage" },
        ],
      },
      "s1-cmd",
    );
    assert.equal(bucket.state.availableCommands?.length, 2);

    const empty = createSessionState({ id: "s1", workspace: "/w" });
    empty.timeline = [];
    empty.availableCommands = [];
    hydrateSessionBucket(bucket, empty);
    assert.equal(bucket.state.availableCommands?.length, 2);
    assert.equal(bucket.state.availableCommands?.[0]?.name, "compact");
  });

  it("stamped _meta.totalTokens updates occupancy mid-turn", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket(
      createSessionState({ id: "s1", workspace: "/w" }),
    );
    const first = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "…" },
        _meta: { totalTokens: 20_000 },
      },
      "s1-1",
    );
    assert.equal(first.tokenUsage?.contextTokensUsed, 20_000);
    const second = reduceSessionUpdate(
      bucket,
      {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "grep",
        _meta: { totalTokens: 35_000 },
      },
      "s1-2",
    );
    assert.equal(second.tokenUsage?.contextTokensUsed, 35_000);
  });
});
