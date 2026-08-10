/**
 * eventId set-based dedupe — covers non-monotonic task_* reorder windows.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
  EventIdDedupe,
  extractEventId,
  resetTimelineIdCounter,
} from "../src/index.js";

describe("extractEventId", () => {
  it("reads params-level _meta.eventId (wire shape)", () => {
    assert.equal(
      extractEventId({
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk" },
        _meta: { eventId: "s1-42" },
      }),
      "s1-42",
    );
  });

  it("reads update-level _meta when params-level is absent", () => {
    assert.equal(
      extractEventId({
        update: {
          sessionUpdate: "tool_call_update",
          _meta: { eventId: "s1-10" },
        },
      }),
      "s1-10",
    );
  });

  it("returns null when no eventId", () => {
    assert.equal(extractEventId({ update: { sessionUpdate: "plan" } }), null);
  });
});

describe("EventIdDedupe", () => {
  it("accepts first sighting and rejects duplicates", () => {
    const d = new EventIdDedupe(8);
    assert.equal(d.accept("a-1"), true);
    assert.equal(d.accept("a-1"), false);
    assert.equal(d.accept("a-2"), true);
    assert.equal(d.size, 2);
  });

  it("always accepts missing eventId (cannot dedupe safely)", () => {
    const d = new EventIdDedupe();
    assert.equal(d.accept(null), true);
    assert.equal(d.accept(undefined), true);
    assert.equal(d.accept(""), true);
    assert.equal(d.size, 0);
  });

  it("evicts oldest when over capacity", () => {
    const d = new EventIdDedupe(2);
    assert.equal(d.accept("1"), true);
    assert.equal(d.accept("2"), true);
    assert.equal(d.accept("3"), true);
    // "1" was evicted by "3" — re-accept is allowed
    assert.equal(d.accept("1"), true);
    // FIFO: accepting "1" again evicts oldest remaining ("2"); "3" stays
    assert.equal(d.has("2"), false);
    assert.equal(d.has("3"), true);
  });

  it("does not drop reordered task_* before tool_call_update (set, not watermark)", () => {
    // Simulated non-monotonic wire order observed in production traces:
    // tool_call (seq N), then task_backgrounded (N+1), then tool_call_update (N)
    // Wait — the design says task_* (N+1) arrives BEFORE tool_call_update (N).
    // So order: tool_call id-10, task_backgrounded id-12, tool_call_update id-11.
    const d = new EventIdDedupe(64);
    const order = ["sid-10", "sid-12", "sid-11"];
    for (const id of order) {
      assert.equal(d.accept(id), true, `must accept ${id}`);
    }
    // Re-delivery of sid-11 (reconnect) is dropped
    assert.equal(d.accept("sid-11"), false);
  });
});

describe("relay reduce with eventId reorder", () => {
  it("applies reordered tool_call_update after task_* without dropping", () => {
    resetTimelineIdCounter();
    let state = createSessionState({ id: "sid", workspace: "/w" });
    const dedupe = new EventIdDedupe();

    const events: Array<{
      eventId: string;
      update: Parameters<typeof applySessionUpdate>[1];
    }> = [
      {
        eventId: "sid-10",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "t1",
          title: "run",
          kind: "execute",
          status: "pending",
        },
      },
      // task_* arrives before the tool_call_update that shares an earlier seq
      {
        eventId: "sid-12",
        update: {
          sessionUpdate: "task_backgrounded",
          taskId: "bg1",
          toolCallId: "t1",
          command: "sleep 1",
          status: "running",
        } as Parameters<typeof applySessionUpdate>[1],
      },
      {
        eventId: "sid-11",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "t1",
          status: "in_progress",
        },
      },
    ];

    for (const ev of events) {
      if (!dedupe.accept(ev.eventId)) {
        assert.fail(`dropped ${ev.eventId}`);
      }
      state = applySessionUpdate(state, ev.update);
    }

    assert.equal(state.toolCalls.t1?.status, "in_progress");
    // Duplicate delivery of sid-11 must not re-apply / corrupt
    assert.equal(dedupe.accept("sid-11"), false);
    assert.equal(state.toolCalls.t1?.status, "in_progress");
  });
});
