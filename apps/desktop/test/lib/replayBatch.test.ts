/**
 * Load-replay batching: silent reduce during the window, single paint on end.
 * Drives the shipped createLiveBridgeDispatch path (same as connectLiveBridge).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  resetTimelineIdCounter,
  type SessionState,
  type SessionUpdate,
} from "@grok-desktop/acp-core";
import {
  createLiveBridgeDispatch,
  makeAgentChunkUpdates,
  REPLAY_TIMEOUT_MS,
  type ReplayDispatchClock,
} from "@/bridge/liveBridgeDispatch";
import {
  createSessionReduceBucket,
  reduceSessionUpdate,
} from "@/lib/sessionReduce";

/** Build ≥50 ordered agent chunks for sequential vs batch parity. */
function fixtureUpdates(n = 55): { update: SessionUpdate; eventId: string }[] {
  return makeAgentChunkUpdates(n, "s1");
}

/** Sequential reduce of the same fixture (live path baseline). */
function reduceSequential(
  updates: { update: SessionUpdate; eventId: string }[],
): SessionState {
  resetTimelineIdCounter();
  const bucket = createSessionReduceBucket(
    createSessionState({ id: "s1", workspace: "/w" }),
  );
  for (const u of updates) {
    reduceSessionUpdate(bucket, u.update, u.eventId);
  }
  return bucket.state;
}

describe("replay batch (createLiveBridgeDispatch)", () => {
  it("批量 reduce 与逐条 reduce 结果深相等", () => {
    const updates = fixtureUpdates(55);
    const sequential = reduceSequential(updates);

    resetTimelineIdCounter();
    const states: SessionState[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: (s) => {
          states.push(s);
        },
      },
    });
    // Seed id so catalog keys match.
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
    });
    states.length = 0;

    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    for (const u of updates) {
      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: "s1",
        update: u.update,
        eventId: u.eventId,
      });
    }
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      updates,
      status: "idle",
      count: updates.length,
      bytes: 0,
      elapsedMs: 1,
    });

    assert.equal(states.length, 1);
    // Batch path may re-apply via replay_end.updates after silent mid-window
    // reduces already consumed eventIds — so also test pure batch without mids.
    resetTimelineIdCounter();
    const pureStates: SessionState[] = [];
    const pure = createLiveBridgeDispatch({
      handlers: { onState: (s) => pureStates.push(s) },
    });
    pure.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
    });
    pureStates.length = 0;
    pure.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    pure.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      updates,
      status: "idle",
      count: updates.length,
      bytes: 0,
      elapsedMs: 1,
    });
    assert.equal(pureStates.length, 1);
    const batched = pureStates[0]!;
    // timeline ids include a time suffix — compare semantic content, not ids.
    assert.equal(batched.status, "idle");
    assert.equal(batched.lastAgentText, sequential.lastAgentText);
    assert.equal(batched.timeline.length, sequential.timeline.length);
    assert.equal(
      batched.timeline.filter((t) => t.kind === "agent").length,
      sequential.timeline.filter((t) => t.kind === "agent").length,
    );
    for (let i = 0; i < sequential.timeline.length; i++) {
      const a = sequential.timeline[i];
      const b = batched.timeline[i];
      assert.equal(a?.kind, b?.kind);
      if (a?.kind === "agent" && b?.kind === "agent") {
        assert.equal(a.text, b.text);
      }
    }
  });

  it("回放期间不通知 store", () => {
    const updates = fixtureUpdates(20);
    let onState = 0;
    let onSessionUpdate = 0;
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: () => {
          onState += 1;
        },
        onSessionUpdate: () => {
          onSessionUpdate += 1;
        },
      },
    });
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    for (const u of updates) {
      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: "s1",
        update: u.update,
        eventId: u.eventId,
      });
    }
    assert.equal(onState, 0);
    assert.equal(onSessionUpdate, 0);
  });

  it("replay_end 只绘制一次", () => {
    const updates = fixtureUpdates(30);
    const states: SessionState[] = [];
    resetTimelineIdCounter();
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: (s) => {
          states.push(s);
        },
      },
    });
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
    });
    states.length = 0;
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    // Mid-window updates silent (Node may still send before gate; Go sends none).
    for (const u of updates) {
      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: "s1",
        update: u.update,
        eventId: u.eventId,
      });
    }
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      // Go-style: omit updates already applied silently; status authoritative.
      status: "idle",
      count: updates.length,
      bytes: 1,
      elapsedMs: 2,
    });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.status, "idle");
    assert.ok((states[0]?.timeline.length ?? 0) > 0);
  });

  it("按 sessionId 隔离(I3)", () => {
    const s2Notifies: string[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: () => {
          /* ignore full paints */
        },
        onSessionUpdate: (session, meta) => {
          if (meta.sessionId === "s2" && meta.applied) {
            s2Notifies.push(session.lastAgentText);
          }
        },
      },
    });
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    // s1 silent
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "s1-a" },
      },
      eventId: "s1-1",
    });
    // s2 live
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: "s2",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "s2-a" },
      },
      eventId: "s2-1",
    });
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: "s2",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "s2-b" },
      },
      eventId: "s2-2",
    });
    assert.equal(s2Notifies.length, 2);
    // Chunks append: "s2-a" then "s2-a"+"s2-b".
    assert.equal(s2Notifies[0], "s2-a");
    assert.equal(s2Notifies[1], "s2-as2-b");
  });

  it("eventId 去重在批量路径仍生效", () => {
    resetTimelineIdCounter();
    const states: SessionState[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: { onState: (s) => states.push(s) },
    });
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
    });
    states.length = 0;
    const updates: { update: SessionUpdate; eventId: string }[] = [
      {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "A" },
        },
        eventId: "dup-1",
      },
      {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "A" },
        },
        eventId: "dup-1",
      },
      {
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "B" },
        },
        eventId: "dup-2",
      },
    ];
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      updates,
      status: "idle",
      count: 3,
      bytes: 0,
      elapsedMs: 0,
    });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.lastAgentText, "AB");
    assert.equal(
      states[0]?.timeline.filter((t) => t.kind === "agent").length,
      1,
    );
  });

  it("socket 关闭强制 flush(I4)", () => {
    let onState = 0;
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: () => {
          onState += 1;
        },
      },
    });
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "x" },
      },
      eventId: "s1-1",
    });
    assert.equal(onState, 0);
    dispatch.flushAllReplays();
    assert.equal(onState, 1);
    assert.deepEqual(dispatch.replayingSessionIds(), []);
  });

  it("超时强制 flush(I4)", () => {
    const timers: { fn: () => void; ms: number }[] = [];
    const clock: ReplayDispatchClock = {
      setTimeout: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => {
        /* leave list; fns not auto-run */
      },
    };
    let onState = 0;
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: () => {
          onState += 1;
        },
      },
      clock,
      replayTimeoutMs: REPLAY_TIMEOUT_MS,
    });
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    assert.equal(timers.length, 1);
    assert.equal(timers[0]?.ms, REPLAY_TIMEOUT_MS);
    assert.equal(onState, 0);
    timers[0]?.fn();
    assert.equal(onState, 1);
    assert.deepEqual(dispatch.replayingSessionIds(), []);
  });

  it("旧 bridge 退化(I6)", () => {
    const notifies: string[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: () => {
          /* */
        },
        onSessionUpdate: (session, meta) => {
          if (meta.applied) {
            notifies.push(session.lastAgentText);
          }
        },
      },
    });
    // No replay_begin — per-update fan-out (current behavior).
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "a" },
      },
      eventId: "1",
    });
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: "s1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "b" },
      },
      eventId: "2",
    });
    assert.equal(notifies.length, 2);
    assert.equal(notifies[0], "a");
    assert.equal(notifies[1], "ab");
  });

  it("权威终态覆盖(T7)", () => {
    resetTimelineIdCounter();
    const states: SessionState[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: { onState: (s) => states.push(s) },
    });
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
    });
    states.length = 0;
    const updates = [
      {
        update: {
          sessionUpdate: "agent_message_chunk" as const,
          content: { type: "text" as const, text: "done" },
        },
        eventId: "e1",
      },
    ];
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      updates,
      status: "idle",
      model: "fixture-model",
      mode: "build",
      count: 1,
      bytes: 10,
      elapsedMs: 5,
    });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.status, "idle");
    assert.equal(states[0]?.model, "fixture-model");
    assert.equal(states[0]?.lastAgentText, "done");
  });

  it("Go empty state after replay_end does not wipe history", () => {
    resetTimelineIdCounter();
    const states: SessionState[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: { onState: (s) => states.push(s) },
    });
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
    });
    states.length = 0;
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      updates: [
        {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "history body" },
          },
          eventId: "e1",
        },
      ],
      status: "idle",
      count: 1,
      bytes: 20,
      elapsedMs: 10,
    });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.lastAgentText, "history body");
    // Post-handshake Go state: empty timeline must not blank the canvas.
    dispatch.handleServerMsg({
      type: "state",
      session: {
        ...createSessionState({ id: "s1", workspace: "/w" }),
        status: "idle",
        model: "post-load-model",
        timeline: [],
      },
    });
    assert.equal(states.length, 2);
    assert.equal(states[1]?.lastAgentText, "history body");
    assert.ok((states[1]?.timeline.length ?? 0) > 0);
    assert.equal(states[1]?.model, "post-load-model");
  });

  it("empty state during open replay does not abort or paint", () => {
    const states: SessionState[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: { onState: (s) => states.push(s) },
    });
    dispatch.handleServerMsg({ type: "replay_begin", sessionId: "s1" });
    assert.deepEqual(dispatch.replayingSessionIds(), ["s1"]);
    dispatch.handleServerMsg({
      type: "state",
      session: {
        ...createSessionState({ id: "s1", workspace: "/w" }),
        timeline: [],
      },
    });
    // Still replaying; no store paint from the empty hydrate.
    assert.deepEqual(dispatch.replayingSessionIds(), ["s1"]);
    assert.equal(states.length, 0);
    dispatch.handleServerMsg({
      type: "replay_end",
      sessionId: "s1",
      updates: [
        {
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "after silence" },
          },
          eventId: "e1",
        },
      ],
      status: "idle",
      count: 1,
      bytes: 5,
      elapsedMs: 1,
    });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.lastAgentText, "after silence");
  });

  it("seedSession prefill survives empty lifecycle-style state", () => {
    const states: SessionState[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: { onState: (s) => states.push(s) },
    });
    const seed = createSessionState({ id: "s1", workspace: "/w" });
    seed.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "from catalog" }],
      },
      { kind: "agent", id: "a1", text: "cached" },
    ];
    seed.lastAgentText = "cached";
    dispatch.seedSession(seed);
    assert.equal(dispatch.bucketFor("s1").state.timeline.length, 2);
    dispatch.handleServerMsg({
      type: "state",
      session: {
        ...createSessionState({ id: "s1", workspace: "/w" }),
        status: "idle",
        model: "grok",
        timeline: [],
      },
    });
    assert.equal(states.length, 1);
    assert.equal(states[0]?.lastAgentText, "cached");
    assert.equal(states[0]?.model, "grok");
    assert.equal(states[0]?.timeline.length, 2);
  });
});
