/**
 * Login-state poll cadence: armed only while live, leading probe, 3s interval.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTH_POLL_MS,
  shouldArmAuthPoll,
  startAuthPollLoop,
} from "@/lib/authPoll";
import { BRIDGE_RECONNECT_MS } from "@/lib/bridgeReconnect";

/**
 * Fake interval host that records the pending tick and lets tests fire it.
 * @returns Timers matching AuthPollTimers plus inspect / fire helpers.
 */
function makeFakeTimers() {
  const intervals = new Map<number, { handler: () => void; ms: number }>();
  let nextId = 1;
  return {
    intervals,
    setInterval: (handler: () => void, ms: number) => {
      const id = nextId;
      nextId += 1;
      intervals.set(id, { handler, ms });
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
    /** Delay of the single pending interval, or undefined when none is armed. */
    pendingMs: () => [...intervals.values()][0]?.ms,
    /** Fire the pending tick once. */
    fire: () => {
      [...intervals.values()][0]?.handler();
    },
  };
}

describe("auth poll cadence", () => {
  it("arms only on a live bridge", () => {
    assert.equal(shouldArmAuthPoll("live-bridge"), true);
    assert.equal(shouldArmAuthPoll("disconnected"), false);
    assert.equal(shouldArmAuthPoll("connecting"), false);
  });

  it("ticks every 3s, matching the reconnect cadence", () => {
    assert.equal(AUTH_POLL_MS, 3_000);
    assert.equal(AUTH_POLL_MS, BRIDGE_RECONNECT_MS);
  });

  it("probes immediately so the gate does not wait a full tick", () => {
    const timers = makeFakeTimers();
    let probes = 0;
    startAuthPollLoop(() => {
      probes += 1;
    }, timers);
    assert.equal(probes, 1);
    assert.equal(timers.pendingMs(), AUTH_POLL_MS);
  });

  it("keeps probing on each tick and stops after cleanup", () => {
    const timers = makeFakeTimers();
    let probes = 0;
    const stop = startAuthPollLoop(() => {
      probes += 1;
    }, timers);
    timers.fire();
    timers.fire();
    assert.equal(probes, 3);
    stop();
    assert.equal(timers.intervals.size, 0);
  });
});
