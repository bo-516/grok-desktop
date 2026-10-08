/**
 * Pure sequencing rules for bridge session streams: apply / drop / resync
 * verdicts, snapshot anchoring and the per-session epoch bound.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADOPT_NEXT,
  classifyFrame,
  MAX_EPOCHS_PER_SESSION,
  recordPosition,
  shouldAdoptSnapshot,
  streamKey,
} from "@/bridge/liveBridgeStreamSeq";

describe("classifyFrame", () => {
  it("adopts the first frame of a session the client never saw (late joiner)", () => {
    assert.deepEqual(
      classifyFrame({ last: undefined, sessionKnown: false, inflight: false, seq: 57 }),
      { action: "apply" },
    );
  });

  it("adopts seq 1 of a new epoch (respawn / reload)", () => {
    assert.deepEqual(
      classifyFrame({ last: undefined, sessionKnown: true, inflight: false, seq: 1 }),
      { action: "apply" },
    );
  });

  it("resyncs a new epoch of a known session from 0 when its start was missed", () => {
    assert.deepEqual(
      classifyFrame({ last: undefined, sessionKnown: true, inflight: false, seq: 4 }),
      { action: "resync", fromSeq: 0 },
    );
    assert.deepEqual(
      classifyFrame({ last: undefined, sessionKnown: true, inflight: true, seq: 5 }),
      { action: "drop", reason: "awaiting-resync" },
    );
  });

  it("applies the next seq and drops duplicates", () => {
    assert.deepEqual(
      classifyFrame({ last: 3, sessionKnown: true, inflight: false, seq: 4 }),
      { action: "apply" },
    );
    for (const seq of [1, 3]) {
      assert.deepEqual(
        classifyFrame({ last: 3, sessionKnown: true, inflight: false, seq }),
        { action: "drop", reason: "duplicate" },
      );
    }
  });

  it("asks for the frames after the last applied one on a gap, once", () => {
    assert.deepEqual(
      classifyFrame({ last: 3, sessionKnown: true, inflight: false, seq: 6 }),
      { action: "resync", fromSeq: 3 },
    );
    assert.deepEqual(
      classifyFrame({ last: 3, sessionKnown: true, inflight: true, seq: 7 }),
      { action: "drop", reason: "awaiting-resync" },
    );
    // A contiguous frame is still safe to apply while a resync is pending.
    assert.deepEqual(
      classifyFrame({ last: 3, sessionKnown: true, inflight: true, seq: 4 }),
      { action: "apply" },
    );
  });

  it("adopts anything after a fallback marked the stream ADOPT_NEXT", () => {
    assert.deepEqual(
      classifyFrame({ last: ADOPT_NEXT, sessionKnown: true, inflight: false, seq: 999 }),
      { action: "apply" },
    );
  });
});

describe("shouldAdoptSnapshot", () => {
  it("anchors unknown or abandoned streams only", () => {
    assert.equal(shouldAdoptSnapshot(undefined, false), true);
    assert.equal(shouldAdoptSnapshot(ADOPT_NEXT, false), true);
    assert.equal(shouldAdoptSnapshot(5, false), false, "live frames are authoritative");
    assert.equal(shouldAdoptSnapshot(undefined, true), false, "never during a resync");
  });
});

describe("recordPosition", () => {
  it("keeps at most MAX_EPOCHS_PER_SESSION epochs, evicting the oldest", () => {
    const positions = new Map<string, Map<string, number>>();
    for (let i = 0; i <= MAX_EPOCHS_PER_SESSION; i += 1) {
      recordPosition(positions, "s", `e${i}`, i);
    }
    const epochs = positions.get("s");
    assert.equal(epochs?.size, MAX_EPOCHS_PER_SESSION);
    assert.equal(epochs?.has("e0"), false);
    assert.equal(epochs?.get(`e${MAX_EPOCHS_PER_SESSION}`), MAX_EPOCHS_PER_SESSION);
  });

  it("streamKey separates session and epoch", () => {
    assert.notEqual(streamKey("a", "bc"), streamKey("ab", "c"));
  });
});
