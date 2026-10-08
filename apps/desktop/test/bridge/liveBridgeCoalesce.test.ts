/**
 * Stream coalescer unit tests (no dispatcher): urgency predicate, lanes,
 * frame sharing / release, emitNow ordering and re-entrant emits.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  BACKGROUND_FLUSH_MS,
  createStreamCoalescer,
  needsImmediateFlush,
  type StreamCoalescer,
} from "@/bridge/liveBridgeCoalesce";
import { createFakeFrameClock } from "../helpers/fakeFrameClock.js";

/**
 * Coalescer + clock + emit log.
 * @param foreground Ids treated as foreground (others background).
 */
function makeCoalescer(foreground: string[]): {
  coalescer: StreamCoalescer;
  emits: string[];
  clock: ReturnType<typeof createFakeFrameClock>;
  onEmit: { hook?: (sessionId: string) => void };
} {
  const clock = createFakeFrameClock();
  const emits: string[] = [];
  const onEmit: { hook?: (sessionId: string) => void } = {};
  const coalescer = createStreamCoalescer({
    scheduler: clock.scheduler,
    isForeground: (id) => foreground.includes(id),
    emit: (id, eventId) => {
      emits.push(`${id}@${eventId ?? "-"}`);
      onEmit.hook?.(id);
    },
  });
  return { coalescer, emits, clock, onEmit };
}

describe("needsImmediateFlush", () => {
  const base = createSessionState({ id: "a", workspace: "/w" });

  it("is false for timeline-only changes", () => {
    assert.equal(
      needsImmediateFlush(base, { ...base, lastAgentText: "x", timeline: [] }),
      false,
    );
  });

  it("is true for status, permission, mode, model, error and config changes", () => {
    const cases = [
      { status: "streaming" as const },
      { pendingPermission: { requestId: 1 } },
      { mode: "plan" as const },
      { model: "other" },
      { errorMessage: "boom" },
      { configOptions: [] },
    ];
    for (const patch of cases) {
      assert.equal(
        needsImmediateFlush(base, { ...base, ...patch }),
        true,
        JSON.stringify(patch),
      );
    }
  });
});

describe("createStreamCoalescer", () => {
  it("shares one frame request across foreground sessions and releases it", () => {
    const { coalescer, emits, clock } = makeCoalescer(["a", "b"]);
    coalescer.defer("a", "1");
    coalescer.defer("b", "1");
    coalescer.defer("a", "2");
    assert.equal(clock.queuedFrames(), 1);
    clock.advance(16);
    assert.deepEqual(emits, ["a@2", "b@1"]);
    assert.equal(clock.queuedFrames(), 0);
  });

  it("background lane waits BACKGROUND_FLUSH_MS from the first pending update", () => {
    const { coalescer, emits, clock } = makeCoalescer([]);
    coalescer.defer("bg", "1");
    clock.advance(BACKGROUND_FLUSH_MS - 1);
    coalescer.defer("bg", "2");
    assert.deepEqual(emits, []);
    clock.advance(1);
    assert.deepEqual(emits, ["bg@2"]);
    assert.equal(clock.armedTimers(), 0);
  });

  it("emitNow drains older entries first, then emits the urgent session once", () => {
    const { coalescer, emits, clock } = makeCoalescer(["a"]);
    coalescer.defer("a", "a1");
    coalescer.defer("bg", "b1");
    coalescer.defer("c", "c1");
    coalescer.emitNow("bg", "b2");
    assert.deepEqual(emits, ["a@a1", "c@c1", "bg@b2"]);
    assert.deepEqual(coalescer.pendingIds(), []);
    assert.equal(clock.queuedFrames(), 0);
    assert.equal(clock.armedTimers(), 0);
  });

  it("emitNow keeps the pending eventId when the urgent frame has none", () => {
    const { coalescer, emits } = makeCoalescer(["a"]);
    coalescer.defer("a", "a7");
    coalescer.emitNow("a", undefined);
    assert.deepEqual(emits, ["a@a7"]);
  });

  it("re-entrant flushAll from inside an emit never double-emits", () => {
    const { coalescer, emits, clock, onEmit } = makeCoalescer(["a", "b", "c"]);
    coalescer.defer("a", "1");
    coalescer.defer("b", "1");
    coalescer.defer("c", "1");
    onEmit.hook = (id) => {
      if (id === "a") {
        coalescer.flushAll();
      }
    };
    clock.advance(16);
    assert.deepEqual(emits, ["a@1", "b@1", "c@1"]);
  });

  it("a defer from inside an emit schedules the next frame", () => {
    const { coalescer, emits, clock, onEmit } = makeCoalescer(["a"]);
    coalescer.defer("a", "1");
    onEmit.hook = () => {
      onEmit.hook = undefined;
      coalescer.defer("a", "2");
    };
    clock.advance(16);
    assert.deepEqual(emits, ["a@1"]);
    clock.advance(16);
    assert.deepEqual(emits, ["a@1", "a@2"]);
  });
});
