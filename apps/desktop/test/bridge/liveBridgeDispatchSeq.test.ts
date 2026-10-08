/**
 * Bridge seq/epoch gate through the shipped createLiveBridgeDispatch path
 * (same object connectLiveBridge builds) with a fake socket send and a fake
 * frame clock: duplicates, gaps → resync, too_old / epoch_mismatch /
 * timeout fallback, epoch changes, snapshots and unstamped legacy frames.
 *
 * Chunks carry no eventId on purpose: the eventId dedupe ring would hide a
 * duplicate, so these tests prove the seq gate itself drops it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  createLiveBridgeDispatch,
  type LiveBridgeDispatch,
} from "@/bridge/liveBridgeDispatch";
import type { BridgeServerMsg } from "@/bridge/liveBridgeTypes";
import type { StreamResetReason } from "@/bridge/liveBridgeStreamTypes";
import {
  createFakeFrameClock,
  type FakeFrameClock,
} from "../helpers/fakeFrameClock.js";

/** Resync answer timeout used by the rig (ms). */
const RESYNC_MS = 1000;

/** Test rig: dispatch + fake socket + ordered event log. */
type Rig = {
  dispatch: LiveBridgeDispatch;
  clock: FakeFrameClock;
  /** Requests the gate sent on the fake socket. */
  requests: Array<Record<string, unknown>>;
  /** Stream resets reported to the handler. */
  resets: Array<{ sessionId: string; reason: StreamResetReason }>;
  /** "notify:<sid>:<text>" and "request:<type>" in arrival order. */
  log: string[];
  /** Feed one inbound frame. */
  recv: (msg: BridgeServerMsg) => void;
  /** Painted lastAgentText of a session (bucket truth). */
  text: (sessionId: string) => string;
};

/**
 * Build a coalescing dispatch wired to a recording fake socket.
 * @param socketOpen False makes every send fail (socket down).
 */
function makeRig(socketOpen = true): Rig {
  const clock = createFakeFrameClock();
  const requests: Array<Record<string, unknown>> = [];
  const resets: Rig["resets"] = [];
  const log: string[] = [];
  const dispatch = createLiveBridgeDispatch({
    handlers: {
      onState: (s) => {
        log.push(`notify:${s.id}:${s.lastAgentText}`);
      },
      onSessionUpdate: (s, meta) => {
        log.push(`notify:${meta.sessionId}:${s.lastAgentText}`);
      },
      onStreamReset: (sessionId, reason) => {
        resets.push({ sessionId, reason });
      },
    },
    clock: {
      setTimeout: (fn, ms) =>
        clock.scheduler.delay(fn, ms) as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: (id) => {
        (id as unknown as () => void)();
      },
    },
    coalesce: { scheduler: clock.scheduler },
    sendRequest: (msg) => {
      requests.push(msg);
      log.push(`request:${String(msg.type)}`);
      return socketOpen;
    },
    resyncTimeoutMs: RESYNC_MS,
  });
  return {
    dispatch,
    clock,
    requests,
    resets,
    log,
    recv: (msg) => {
      dispatch.handleServerMsg(msg);
    },
    text: (sessionId) => dispatch.bucketFor(sessionId).state.lastAgentText,
  };
}

/**
 * Stamped agent_message_chunk without eventId (text `w{i} `).
 * @param sessionId Target session. @param i Chunk index.
 * @param epoch Stream epoch (omit for a legacy unstamped frame).
 * @param seq Stream seq (defaults to i).
 */
function chunk(
  sessionId: string,
  i: number,
  epoch?: string,
  seq: number = i,
): BridgeServerMsg {
  const base: BridgeServerMsg = {
    type: "session_update",
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `w${i} ` },
    },
  };
  return epoch === undefined ? base : { ...base, epoch, seq };
}

/**
 * resync_result frame.
 * @param sessionId Session. @param epoch Requested epoch.
 * @param status Outcome. @param frames Frames for status ok.
 */
function resyncResult(
  sessionId: string,
  epoch: string,
  status: "ok" | "too_old" | "epoch_mismatch",
  frames?: BridgeServerMsg[],
): BridgeServerMsg {
  return {
    type: "resync_result",
    sessionId,
    status,
    epoch,
    fromSeq: 0,
    headSeq: frames?.length ?? 0,
    ...(frames ? { frames } : {}),
  };
}

describe("dispatch seq gate", () => {
  it("applies in-order frames and drops a duplicate seq", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 2, "e1"));
    rig.recv(chunk("s", 2, "e1"));
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 w2 ");
    assert.deepEqual(rig.requests, []);
  });

  it("on a gap: drains the coalescer, drops the frame, requests resync once", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 2, "e1"));
    rig.recv(chunk("s", 5, "e1"));
    rig.recv(chunk("s", 6, "e1"));
    // The coalesced w2 paint lands before the request (first chunk is urgent).
    assert.deepEqual(rig.log.slice(-2), ["notify:s:w1 w2 ", "request:resync"]);
    assert.equal(rig.log.filter((l) => l === "request:resync").length, 1);
    assert.deepEqual(rig.requests, [
      { type: "resync", sessionId: "s", epoch: "e1", fromSeq: 2 },
    ]);
    assert.equal(rig.text("s"), "w1 w2 ", "gap frames are not reduced");
    assert.equal(rig.dispatch.pendingResyncs().length, 1);

    rig.recv(
      resyncResult("s", "e1", "ok", [3, 4, 5, 6].map((i) => chunk("s", i, "e1"))),
    );
    rig.recv(chunk("s", 7, "e1"));
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 w2 w3 w4 w5 w6 w7 ");
    assert.equal(rig.dispatch.pendingResyncs().length, 0);
    assert.equal(rig.requests.length, 1);
  });

  it("resync frames already applied are dropped as duplicates", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 3, "e1"));
    rig.recv(
      resyncResult("s", "e1", "ok", [1, 2, 3].map((i) => chunk("s", i, "e1"))),
    );
    assert.equal(rig.text("s"), "w1 w2 w3 ");
  });

  for (const status of ["too_old", "epoch_mismatch"] as const) {
    it(`${status}: falls back to get_state and re-anchors on the next frame`, () => {
      const rig = makeRig();
      rig.recv(chunk("s", 1, "e1"));
      rig.recv(chunk("s", 9, "e1"));
      rig.recv(resyncResult("s", "e1", status));
      assert.deepEqual(rig.requests.at(-1), { type: "get_state", sessionId: "s" });
      assert.deepEqual(rig.resets, [{ sessionId: "s", reason: status }]);
      rig.recv(chunk("s", 12, "e1"));
      rig.recv(chunk("s", 13, "e1"));
      rig.clock.advance(16);
      assert.equal(rig.text("s"), "w1 w12 w13 ");
    });
  }

  it("times out an unanswered resync and ignores the late answer", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 4, "e1"));
    rig.clock.advance(RESYNC_MS);
    assert.deepEqual(rig.resets, [{ sessionId: "s", reason: "timeout" }]);
    assert.deepEqual(rig.requests.at(-1), { type: "get_state", sessionId: "s" });
    rig.recv(
      resyncResult("s", "e1", "ok", [2, 3, 4].map((i) => chunk("s", i, "e1"))),
    );
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 ", "stale answer must not replay");
  });

  it("adopts a new epoch starting at seq 1 (respawn) without a resync", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 2, "e1"));
    rig.recv(chunk("s", 3, "e2", 1));
    rig.recv(chunk("s", 4, "e2", 2));
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 w2 w3 w4 ");
    assert.deepEqual(rig.requests, []);
    assert.equal(rig.dispatch.pendingResyncs().length, 0);
  });

  it("resyncs a new epoch from 0 when its first frames were missed", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 9, "e2", 3));
    assert.deepEqual(rig.requests, [
      { type: "resync", sessionId: "s", epoch: "e2", fromSeq: 0 },
    ]);
    rig.recv(
      resyncResult("s", "e2", "ok", [1, 2, 3].map((i) => chunk("s", 6 + i, "e2", i))),
    );
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 w7 w8 w9 ");
  });

  it("keeps two live epochs of one session apart (child hosted + opened)", () => {
    const rig = makeRig();
    rig.recv(chunk("c", 1, "host", 1));
    rig.recv(chunk("c", 2, "own", 1));
    rig.recv(chunk("c", 3, "host", 2));
    rig.recv(chunk("c", 4, "own", 2));
    rig.recv(chunk("c", 4, "own", 2));
    rig.clock.advance(16);
    assert.equal(rig.text("c"), "w1 w2 w3 w4 ");
    assert.deepEqual(rig.requests, []);
  });

  it("a gap in one session does not hold back another", () => {
    const rig = makeRig();
    rig.recv(chunk("a", 1, "e1"));
    rig.recv(chunk("a", 3, "e1"));
    rig.recv(chunk("b", 1, "e1"));
    rig.recv(chunk("b", 2, "e1"));
    rig.clock.advance(16);
    assert.equal(rig.text("a"), "w1 ");
    assert.equal(rig.text("b"), "w1 w2 ");
  });

  it("a state snapshot (headSeq) anchors a stream the client never saw", () => {
    const rig = makeRig();
    rig.recv({
      type: "state",
      session: createSessionState({ id: "s", workspace: "/w" }),
      epoch: "e1",
      headSeq: 10,
    });
    rig.recv(chunk("s", 11, "e1"));
    rig.recv(chunk("s", 13, "e1"));
    assert.deepEqual(rig.requests, [
      { type: "resync", sessionId: "s", epoch: "e1", fromSeq: 11 },
    ]);
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w11 ");
  });

  it("unstamped legacy frames pass through untouched, even between stamped ones", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1));
    rig.recv(chunk("s", 2, "e1", 1));
    rig.recv(chunk("s", 3));
    rig.recv(chunk("s", 4, "e1", 2));
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 w2 w3 w4 ");
    assert.deepEqual(rig.requests, []);
  });

  it("socket down: a gap re-anchors locally instead of waiting forever", () => {
    const rig = makeRig(false);
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 5, "e1"));
    rig.recv(chunk("s", 6, "e1"));
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w1 w6 ");
    assert.equal(rig.dispatch.pendingResyncs().length, 0);
  });

  it("clearBuckets drops positions and cancels pending resync timers", () => {
    const rig = makeRig();
    rig.recv(chunk("s", 1, "e1"));
    rig.recv(chunk("s", 3, "e1"));
    rig.dispatch.clearBuckets();
    assert.equal(rig.dispatch.pendingResyncs().length, 0);
    rig.clock.advance(RESYNC_MS * 2);
    assert.deepEqual(rig.resets, [], "no timeout after the socket closed");
    rig.recv(chunk("s", 40, "e1"));
    rig.clock.advance(16);
    assert.equal(rig.text("s"), "w40 ", "fresh connection adopts again");
  });
});
