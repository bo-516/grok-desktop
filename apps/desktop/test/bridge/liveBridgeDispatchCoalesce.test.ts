/**
 * Live stream coalescing through the shipped createLiveBridgeDispatch path
 * (same object connectLiveBridge builds), driven by a fake frame clock:
 * ordering, immediate-flush rules, per-frame cap, lanes, flush on close.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  createLiveBridgeDispatch,
  type LiveBridgeDispatch,
} from "@/bridge/liveBridgeDispatch";
import type { BridgeServerMsg } from "@/bridge/liveBridgeTypes";
import {
  createFakeFrameClock,
  type FakeFrameClock,
} from "../helpers/fakeFrameClock.js";

/** One handler call recorded in arrival order. */
type Call = {
  kind: "update" | "state" | "error" | "info";
  sessionId: string;
  text: string;
  status?: string;
  eventId?: string;
  frame: number;
  session?: SessionState;
};

/** Test rig: dispatch + clock + recorded calls + mutable viewing id. */
type Rig = {
  dispatch: LiveBridgeDispatch;
  clock: FakeFrameClock;
  calls: Call[];
  viewing: { id: string | null };
  send: (msg: BridgeServerMsg) => void;
};

/**
 * Build a coalescing dispatch. Foreground = `viewing.id` (null → everyone).
 * @param backgroundFlushMs Background lane interval.
 */
function makeRig(backgroundFlushMs = 150): Rig {
  const clock = createFakeFrameClock();
  const calls: Call[] = [];
  const viewing: { id: string | null } = { id: null };
  const dispatch = createLiveBridgeDispatch({
    handlers: {
      onState: (s) => {
        calls.push({
          kind: "state",
          sessionId: s.id,
          text: s.lastAgentText,
          status: s.status,
          frame: clock.frameIndex(),
          session: s,
        });
      },
      onSessionUpdate: (s, meta) => {
        calls.push({
          kind: "update",
          sessionId: meta.sessionId,
          text: s.lastAgentText,
          status: s.status,
          eventId: meta.eventId,
          frame: clock.frameIndex(),
          session: s,
        });
      },
      onError: (message, sessionId) => {
        calls.push({
          kind: "error",
          sessionId: sessionId ?? "",
          text: message,
          frame: clock.frameIndex(),
        });
      },
      onInfo: (message, sessionId) => {
        calls.push({
          kind: "info",
          sessionId: sessionId ?? "",
          text: message,
          frame: clock.frameIndex(),
        });
      },
    },
    // Replay timers on the same fake clock so no real 5 s mark keeps Node alive.
    clock: {
      setTimeout: (fn, ms) =>
        clock.scheduler.delay(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: (id) => {
        (id as unknown as () => void)();
      },
    },
    coalesce: {
      scheduler: clock.scheduler,
      isForeground: (id) => viewing.id === null || viewing.id === id,
      backgroundFlushMs,
    },
  });
  return {
    dispatch,
    clock,
    calls,
    viewing,
    send: (msg) => {
      dispatch.handleServerMsg(msg);
    },
  };
}

/**
 * agent_message_chunk session_update.
 * @param sessionId Target session.
 * @param i Chunk index (text `w{i} `, eventId `{sid}-{i}`).
 */
function chunk(sessionId: string, i: number): BridgeServerMsg {
  return {
    type: "session_update",
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `w${i} ` },
    },
    eventId: `${sessionId}-${i}`,
  };
}

/**
 * session_lifecycle frame.
 * @param sessionId Target session.
 * @param status New status.
 * @param extra Optional permission / mode / model.
 */
function lifecycle(
  sessionId: string,
  status: SessionState["status"],
  extra: Partial<Extract<BridgeServerMsg, { type: "session_lifecycle" }>> = {},
): BridgeServerMsg {
  return { type: "session_lifecycle", sessionId, status, ...extra };
}

/**
 * Expected lastAgentText after chunks [from, to].
 * @param from First index (inclusive).
 * @param to Last index (inclusive).
 */
function words(from: number, to: number): string {
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    out.push(`w${i} `);
  }
  return out.join("");
}

/**
 * Seed sessions mid-turn (full `state`, then lifecycle streaming — the
 * idle→streaming edge is itself urgent) and clear the recorded calls.
 * @param rig Test rig.
 * @param ids Session ids to seed.
 */
function seed(rig: Rig, ...ids: string[]): void {
  for (const id of ids) {
    rig.send({ type: "state", session: createSessionState({ id, workspace: "/w" }) });
    rig.send(lifecycle(id, "streaming"));
  }
  rig.calls.length = 0;
}

describe("live stream coalescing (createLiveBridgeDispatch)", () => {
  it("folds a burst of chunks into one notify per frame and keeps every chunk", () => {
    const rig = makeRig();
    seed(rig, "a");
    for (let i = 1; i <= 10; i++) {
      rig.send(chunk("a", i));
    }
    assert.equal(rig.calls.length, 0, "no notify before the frame");
    assert.deepEqual(rig.dispatch.pendingUpdateIds(), ["a"]);
    rig.clock.advance(16);
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.calls[0]!.text, words(1, 10));
    assert.equal(rig.calls[0]!.eventId, "a-10", "latest eventId rides along");
    assert.deepEqual(rig.dispatch.pendingUpdateIds(), []);
    assert.equal(rig.clock.queuedFrames(), 0);
  });

  it("never loses the final chunk and never notifies twice in one frame", () => {
    const rig = makeRig();
    rig.viewing.id = null; // all sessions foreground
    seed(rig, "a", "b", "c");
    // 3 sessions × 60 chunks, one chunk per session every 3 ms.
    for (let i = 1; i <= 60; i++) {
      for (const id of ["a", "b", "c"]) {
        rig.send(chunk(id, i));
      }
      rig.clock.advance(3);
    }
    rig.clock.advance(16);
    const seen = new Set<string>();
    for (const call of rig.calls) {
      const key = `${call.frame}:${call.sessionId}`;
      assert.ok(!seen.has(key), `two notifies for ${key}`);
      seen.add(key);
    }
    for (const id of ["a", "b", "c"]) {
      const last = rig.calls.filter((c) => c.sessionId === id).at(-1);
      assert.equal(last?.text, words(1, 60), `${id} final text`);
      assert.equal(last?.eventId, `${id}-60`);
    }
    assert.ok(rig.calls.length < 3 * 60 / 4, `calls=${rig.calls.length}`);
  });

  it("each notify carries a prefix of the arrival order (ordering preserved)", () => {
    const rig = makeRig();
    seed(rig, "a");
    for (let i = 1; i <= 40; i++) {
      rig.send(chunk("a", i));
      rig.clock.advance(5);
    }
    rig.clock.advance(16);
    let prevLen = 0;
    for (const call of rig.calls) {
      assert.ok(words(1, 40).startsWith(call.text), `not a prefix: ${call.text}`);
      assert.ok(call.text.length > prevLen, "text only grows");
      prevLen = call.text.length;
    }
  });

  it("background sessions flush on the slow lane; the viewed one per frame", () => {
    const rig = makeRig(150);
    rig.viewing.id = "a";
    seed(rig, "a", "b");
    for (let i = 1; i <= 60; i++) {
      rig.send(chunk("a", i));
      rig.send(chunk("b", i));
      rig.clock.advance(5); // 300 ms total
    }
    rig.clock.advance(150);
    const aCalls = rig.calls.filter((c) => c.sessionId === "a");
    const bCalls = rig.calls.filter((c) => c.sessionId === "b");
    assert.ok(aCalls.length >= 15, `foreground per frame, got ${aCalls.length}`);
    assert.ok(bCalls.length <= 3, `background ≤ 3 per 300 ms, got ${bCalls.length}`);
    assert.equal(bCalls.at(-1)?.text, words(1, 60));
  });

  it("status / permission / mode changes notify immediately, after older pending work", () => {
    const rig = makeRig();
    rig.viewing.id = "a";
    seed(rig, "a", "b");
    rig.send(chunk("a", 1));
    rig.send(chunk("b", 1));
    rig.send(lifecycle("b", "idle"));
    assert.deepEqual(
      rig.calls.map((c) => `${c.sessionId}:${c.status}:${c.text}`),
      [`a:streaming:${words(1, 1)}`, `b:idle:${words(1, 1)}`],
      "pending a drains before the urgent b settle",
    );
    rig.calls.length = 0;
    rig.send(chunk("a", 2));
    rig.send(
      lifecycle("a", "waiting_permission", {
        pendingPermission: { requestId: 7, options: [] },
      }),
    );
    assert.equal(rig.calls.length, 1, "pending chunk folds into the urgent notify");
    assert.equal(rig.calls[0]!.status, "waiting_permission");
    assert.equal(rig.calls[0]!.text, words(1, 2));
    rig.calls.length = 0;
    rig.send(chunk("a", 3));
    rig.send({
      type: "session_update",
      sessionId: "a",
      update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
      eventId: "a-mode",
    });
    assert.equal(rig.calls.length, 1, "mode change bypasses the frame");
    assert.equal(rig.calls[0]!.session?.mode, "plan");
    assert.equal(rig.calls[0]!.eventId, "a-mode");
    assert.deepEqual(rig.dispatch.pendingUpdateIds(), []);
  });

  it("errors and other notices run after pending paints", () => {
    const rig = makeRig();
    seed(rig, "a");
    rig.send(chunk("a", 1));
    rig.send({ type: "error", message: "boom", sessionId: "a" });
    assert.deepEqual(
      rig.calls.map((c) => c.kind),
      ["update", "error"],
    );
    rig.calls.length = 0;
    rig.send(chunk("a", 2));
    rig.send({ type: "info", message: "hi" });
    assert.deepEqual(
      rig.calls.map((c) => c.kind),
      ["update", "info"],
    );
  });

  it("replay_begin paints pending chunks before the window resets the body", () => {
    const rig = makeRig();
    seed(rig, "a");
    rig.send(chunk("a", 1));
    rig.send({ type: "replay_begin", sessionId: "a" });
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.calls[0]!.text, words(1, 1));
    rig.calls.length = 0;
    rig.send(chunk("a", 2));
    rig.clock.advance(200);
    assert.equal(rig.calls.length, 0, "replay window stays silent");
    rig.send({
      type: "replay_end",
      sessionId: "a",
      status: "idle",
      count: 0,
      bytes: 0,
      elapsedMs: 1,
    });
    assert.deepEqual(rig.calls.map((c) => c.kind), ["state"]);
  });

  it("a full state hydrate drains pending notifies first", () => {
    const rig = makeRig();
    seed(rig, "a");
    rig.send(chunk("a", 1));
    rig.send({ type: "state", session: createSessionState({ id: "a", workspace: "/w" }) });
    assert.deepEqual(rig.calls.map((c) => c.kind), ["update", "state"]);
  });

  it("flushPendingUpdates (close / switch) emits everything at once", () => {
    const rig = makeRig();
    rig.viewing.id = "a";
    seed(rig, "a", "b");
    rig.send(chunk("a", 1));
    rig.send(chunk("b", 1));
    rig.dispatch.flushPendingUpdates();
    assert.deepEqual(rig.calls.map((c) => c.sessionId), ["a", "b"]);
    assert.equal(rig.clock.queuedFrames(), 0, "frame released");
    assert.equal(rig.clock.armedTimers(), 0, "no background timer left");
    rig.clock.advance(300);
    assert.equal(rig.calls.length, 2, "nothing fires later");
  });

  it("clearBuckets emits pending state before the buckets go away", () => {
    const rig = makeRig();
    seed(rig, "a");
    rig.send(chunk("a", 1));
    rig.dispatch.clearBuckets();
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.calls[0]!.text, words(1, 1));
  });

  it("deduped frames never schedule a notify", () => {
    const rig = makeRig();
    seed(rig, "a");
    rig.send(chunk("a", 1));
    rig.clock.advance(16);
    rig.calls.length = 0;
    rig.send(chunk("a", 1));
    assert.deepEqual(rig.dispatch.pendingUpdateIds(), []);
    rig.clock.advance(32);
    assert.equal(rig.calls.length, 0);
  });

  it("a background entry moves to the frame lane once its session is viewed", () => {
    const rig = makeRig(150);
    rig.viewing.id = "a";
    seed(rig, "a", "b");
    rig.send(chunk("b", 1));
    rig.clock.advance(20);
    assert.equal(rig.calls.length, 0);
    rig.viewing.id = "b";
    rig.send(chunk("b", 2));
    rig.clock.advance(16);
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.calls[0]!.text, words(1, 2));
    rig.clock.advance(200);
    assert.equal(rig.calls.length, 1, "cancelled background timer stays quiet");
  });

  it("emits the bucket's current state, so a seed between defer and flush is kept", () => {
    const rig = makeRig();
    seed(rig, "a");
    rig.send(chunk("a", 1));
    const seeded: SessionState = {
      ...rig.dispatch.bucketFor("a").state,
      title: "seeded title",
    };
    rig.dispatch.seedSession(seeded);
    rig.clock.advance(16);
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.calls[0]!.session, rig.dispatch.bucketFor("a").state);
    assert.equal(rig.calls[0]!.session?.title, "seeded title");
  });

  it("without coalesce every update still notifies synchronously", () => {
    const states: string[] = [];
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: () => undefined,
        onSessionUpdate: (s) => {
          states.push(s.lastAgentText);
        },
      },
    });
    dispatch.handleServerMsg(chunk("a", 1));
    dispatch.handleServerMsg(chunk("a", 2));
    assert.deepEqual(states, [words(1, 1), words(1, 2)]);
    assert.deepEqual(dispatch.pendingUpdateIds(), []);
  });
});
