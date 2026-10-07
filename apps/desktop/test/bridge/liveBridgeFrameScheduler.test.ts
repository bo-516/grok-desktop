/**
 * Production frame scheduler choice: rAF (raced by a watchdog) while the
 * page is visible, a ~16 ms timer when rAF is missing or the page is hidden.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createFrameScheduler,
  FRAME_FALLBACK_MS,
  FRAME_WATCHDOG_MS,
  type FrameSchedulerEnv,
} from "@/bridge/liveBridgeFrameScheduler";

/** Recorded fake env plus manual triggers. */
type FakeEnv = {
  env: FrameSchedulerEnv;
  rafs: Map<number, () => void>;
  timers: Map<number, { cb: () => void; ms: number }>;
  doc: { visibilityState: string };
};

/**
 * Fake browser globals.
 * @param withRaf Whether requestAnimationFrame exists.
 */
function fakeEnv(withRaf: boolean): FakeEnv {
  const rafs = new Map<number, () => void>();
  const timers = new Map<number, { cb: () => void; ms: number }>();
  const doc = { visibilityState: "visible" };
  const seq = { n: 0 };
  const env: FrameSchedulerEnv = {
    setTimeout: (cb, ms) => {
      seq.n += 1;
      timers.set(seq.n, { cb, ms });
      return seq.n as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      timers.delete(id as unknown as number);
    },
    document: doc,
  };
  if (withRaf) {
    env.requestAnimationFrame = (cb) => {
      seq.n += 1;
      rafs.set(seq.n, cb);
      return seq.n;
    };
    env.cancelAnimationFrame = (id) => {
      rafs.delete(id);
    };
  }
  return { env, rafs, timers, doc };
}

/**
 * Fire and remove the only entry of a callback map.
 * @param map rAF or timer map holding exactly one entry.
 */
function fireOnly(map: Map<number, (() => void) | { cb: () => void }>): void {
  assert.equal(map.size, 1);
  const [id, entry] = [...map.entries()][0]!;
  map.delete(id);
  if (typeof entry === "function") {
    entry();
  } else {
    entry.cb();
  }
}

describe("createFrameScheduler", () => {
  it("uses a FRAME_FALLBACK_MS timer when rAF is unavailable", () => {
    const fake = fakeEnv(false);
    const calls: number[] = [];
    createFrameScheduler(fake.env).requestFrame(() => calls.push(1));
    assert.equal(fake.timers.size, 1);
    assert.equal([...fake.timers.values()][0]!.ms, FRAME_FALLBACK_MS);
    fireOnly(fake.timers);
    assert.deepEqual(calls, [1]);
  });

  it("uses the timer while the document is hidden even if rAF exists", () => {
    const fake = fakeEnv(true);
    fake.doc.visibilityState = "hidden";
    createFrameScheduler(fake.env).requestFrame(() => undefined);
    assert.equal(fake.rafs.size, 0);
    assert.equal([...fake.timers.values()][0]!.ms, FRAME_FALLBACK_MS);
  });

  it("races rAF against the watchdog; rAF wins and clears the watchdog", () => {
    const fake = fakeEnv(true);
    const calls: number[] = [];
    createFrameScheduler(fake.env).requestFrame(() => calls.push(1));
    assert.equal(fake.rafs.size, 1);
    assert.equal([...fake.timers.values()][0]!.ms, FRAME_WATCHDOG_MS);
    fireOnly(fake.rafs);
    assert.deepEqual(calls, [1]);
    assert.equal(fake.timers.size, 0, "watchdog cleared");
  });

  it("watchdog wins when rAF stalls (window hidden after the request)", () => {
    const fake = fakeEnv(true);
    const calls: number[] = [];
    createFrameScheduler(fake.env).requestFrame(() => calls.push(1));
    fireOnly(fake.timers);
    assert.deepEqual(calls, [1]);
    assert.equal(fake.rafs.size, 0, "rAF cancelled");
  });

  it("cancel drops both racers and the callback", () => {
    const fake = fakeEnv(true);
    const calls: number[] = [];
    const cancel = createFrameScheduler(fake.env).requestFrame(() =>
      calls.push(1),
    );
    cancel();
    cancel();
    assert.equal(fake.rafs.size, 0);
    assert.equal(fake.timers.size, 0);
    assert.deepEqual(calls, []);
  });

  it("delay wraps setTimeout and clamps negative delays", () => {
    const fake = fakeEnv(false);
    const cancel = createFrameScheduler(fake.env).delay(() => undefined, -5);
    assert.equal([...fake.timers.values()][0]!.ms, 0);
    cancel();
    assert.equal(fake.timers.size, 0);
  });

  it("default env works under Node (no rAF → timer)", async () => {
    const fired = await new Promise<boolean>((resolve) => {
      createFrameScheduler().requestFrame(() => resolve(true));
    });
    assert.equal(fired, true);
  });
});
