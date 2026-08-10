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

  it("hydrate replaces state and lifecycle patches status", () => {
    resetTimelineIdCounter();
    const bucket = createSessionReduceBucket();
    hydrateSessionBucket(
      bucket,
      createSessionState({ id: "h1", workspace: "/x" }),
    );
    assert.equal(bucket.state.id, "h1");

    const next = applySessionLifecycle(bucket, {
      status: "streaming",
      pendingPermission: null,
    });
    assert.equal(next.status, "streaming");
  });
});
