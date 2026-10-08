/**
 * Bridge-asserted provenance through the shipped dispatcher: `own` resolution
 * from this connection's start ids, notify-before-paint ordering, change
 * dedupe, and provenance-carrying info notices.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  createLiveBridgeDispatch,
  type LiveBridgeDispatch,
} from "@/bridge/liveBridgeDispatch";
import { readProvenance } from "@/bridge/liveBridgeProvenance";
import type { BridgeSessionProvenance } from "@/bridge/liveBridgeStreamTypes";
import type { BridgeServerMsg } from "@/bridge/liveBridgeTypes";

/** Rig: synchronous dispatch + ordered log of handler calls. */
type Rig = {
  dispatch: LiveBridgeDispatch;
  log: string[];
  provenance: Array<{ sessionId: string; p: BridgeSessionProvenance }>;
  infos: Array<{ message: string; meta?: { provenance?: BridgeSessionProvenance } }>;
};

/** Build a non-coalescing dispatch that records handler order. */
function makeRig(): Rig {
  const log: string[] = [];
  const provenance: Rig["provenance"] = [];
  const infos: Rig["infos"] = [];
  const dispatch = createLiveBridgeDispatch({
    handlers: {
      onState: (s) => log.push(`state:${s.id}`),
      onSessionUpdate: (_s, meta) => log.push(`update:${meta.sessionId}`),
      onProvenance: (sessionId, p) => {
        log.push(`provenance:${sessionId}`);
        provenance.push({ sessionId, p });
      },
      onInfo: (message, _sessionId, meta) => {
        infos.push({ message, meta });
      },
    },
  });
  return { dispatch, log, provenance, infos };
}

/**
 * Child session_update stamped as the bridge relays it.
 * @param sessionId Child id. @param parent Parent id. @param seq Stream seq.
 */
function childChunk(sessionId: string, parent: string, seq: number): BridgeServerMsg {
  return {
    type: "session_update",
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `c${seq} ` },
    },
    epoch: "e1",
    seq,
    provenance: { kind: "child", parentSessionId: parent },
  };
}

describe("bridge provenance relay", () => {
  it("marks this window's own start and tells the store before the paint", () => {
    const rig = makeRig();
    rig.dispatch.noteOwnStart("start-mine");
    rig.dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s1", workspace: "/w" }),
      epoch: "e1",
      seq: 1,
      provenance: { kind: "started", startId: "start-mine" },
    });
    assert.deepEqual(rig.log, ["provenance:s1", "state:s1"]);
    assert.deepEqual(rig.provenance[0]?.p, {
      kind: "started",
      startId: "start-mine",
      own: true,
    });
  });

  it("another window's start is not own", () => {
    const rig = makeRig();
    rig.dispatch.noteOwnStart("start-mine");
    rig.dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s2", workspace: "/w" }),
      provenance: { kind: "started", startId: "start-theirs" },
    });
    assert.equal(rig.provenance[0]?.p.own, false);
  });

  it("child live frames notify once per change, ahead of the first update", () => {
    const rig = makeRig();
    rig.dispatch.handleServerMsg(childChunk("kid", "parent", 1));
    rig.dispatch.handleServerMsg(childChunk("kid", "parent", 2));
    rig.dispatch.handleServerMsg(childChunk("kid", "parent", 3));
    assert.deepEqual(rig.log, [
      "provenance:kid",
      "update:kid",
      "update:kid",
      "update:kid",
    ]);
    assert.equal(rig.provenance[0]?.p.parentSessionId, "parent");
    // An explicit re-link (nested subagent) is a change and notifies again.
    rig.dispatch.handleServerMsg({
      ...childChunk("kid", "mid", 4),
    });
    assert.equal(rig.provenance.length, 2);
    assert.equal(rig.provenance[1]?.p.parentSessionId, "mid");
  });

  it("routes provenance-carrying info with meta; plain info stays legacy", () => {
    const rig = makeRig();
    rig.dispatch.noteOwnStart("st");
    rig.dispatch.handleServerMsg({
      type: "info",
      message: "session s3 ready",
      sessionId: "s3",
      provenance: { kind: "started", startId: "st" },
    });
    rig.dispatch.handleServerMsg({ type: "info", message: "hello", sessionId: "s3" });
    assert.equal(rig.infos[0]?.meta?.provenance?.own, true);
    assert.equal(rig.infos[1]?.meta, undefined);
  });

  it("ignores malformed provenance", () => {
    const bad = {
      type: "state",
      session: createSessionState({ id: "s4", workspace: "" }),
      provenance: { kind: "bogus" },
    } as unknown as BridgeServerMsg;
    assert.equal(readProvenance(bad), null);
    const rig = makeRig();
    rig.dispatch.handleServerMsg(bad);
    assert.deepEqual(rig.provenance, []);
  });

  it("clearBuckets forgets own start ids (new connection, new starts)", () => {
    const rig = makeRig();
    rig.dispatch.noteOwnStart("st");
    rig.dispatch.clearBuckets();
    rig.dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: "s5", workspace: "/w" }),
      provenance: { kind: "started", startId: "st" },
    });
    assert.equal(rig.provenance[0]?.p.own, false);
  });
});
