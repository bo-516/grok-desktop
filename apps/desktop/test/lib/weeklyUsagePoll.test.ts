/**
 * Account billing poll schedule: immediate first fire, 20s steady cadence,
 * widening ladder while billing keeps failing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startWeeklyUsagePolling,
  weeklyUsageDelayMs,
  WEEKLY_USAGE_FIRST_RETRY_MS,
  WEEKLY_USAGE_MAX_BACKOFF_MS,
  WEEKLY_USAGE_POLL_MS,
  type WeeklyUsageOutcome,
} from "@/lib/weeklyUsagePoll";

/**
 * Fake timer host that records the pending delay and lets tests fire it.
 * @returns Timers matching WeeklyUsagePollTimers plus inspect / fire helpers.
 */
function makeFakeTimers() {
  const timeouts = new Map<number, { handler: () => void; ms: number }>();
  let nextId = 1;
  return {
    timeouts,
    setTimeout: (handler: () => void, ms: number) => {
      const id = nextId;
      nextId += 1;
      timeouts.set(id, { handler, ms });
      return id;
    },
    clearTimeout: (id: number) => {
      timeouts.delete(id);
    },
    /** Delay of the single pending poll, or undefined when none is armed. */
    pendingMs: () => [...timeouts.values()][0]?.ms,
    /** Fire the pending poll and flush the refresh promise chain. */
    fire: async () => {
      const entry = [...timeouts.entries()][0];
      if (!entry) {
        return;
      }
      timeouts.delete(entry[0]);
      entry[1].handler();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

/** Let the immediate first tick settle before asserting on the armed timer. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("weekly usage poll cadence", () => {
  it("exports a 20s poll and a 2s first-connect retry", () => {
    assert.equal(WEEKLY_USAGE_POLL_MS, 20_000);
    assert.equal(WEEKLY_USAGE_FIRST_RETRY_MS, 2_000);
  });

  it("holds the steady cadence while polls succeed", async () => {
    const timers = makeFakeTimers();
    let calls = 0;
    const stop = startWeeklyUsagePolling(async () => {
      calls += 1;
      return "ok";
    }, timers);
    await flush();
    assert.equal(calls, 1);
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_POLL_MS);

    await timers.fire();
    assert.equal(calls, 2);
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_POLL_MS);

    stop();
    assert.equal(timers.timeouts.size, 0);
  });

  it("widens the delay on consecutive failures and resets on success", async () => {
    const timers = makeFakeTimers();
    let outcome: WeeklyUsageOutcome = "fail";
    const stop = startWeeklyUsagePolling(async () => outcome, timers);
    await flush();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_FIRST_RETRY_MS);

    await timers.fire();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_POLL_MS);
    await timers.fire();
    assert.equal(timers.pendingMs(), 60_000);
    await timers.fire();
    assert.equal(timers.pendingMs(), 180_000);
    await timers.fire();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_MAX_BACKOFF_MS);
    await timers.fire();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_MAX_BACKOFF_MS);

    outcome = "ok";
    await timers.fire();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_POLL_MS);
    stop();
  });

  it("treats a skipped refresh as pacing-neutral", async () => {
    const timers = makeFakeTimers();
    let outcome: WeeklyUsageOutcome = "fail";
    const stop = startWeeklyUsagePolling(async () => outcome, timers);
    await flush();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_FIRST_RETRY_MS);

    outcome = "skip";
    await timers.fire();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_FIRST_RETRY_MS);
    stop();
  });

  it("backs off when the refresh throws", async () => {
    const timers = makeFakeTimers();
    const stop = startWeeklyUsagePolling(async () => {
      throw new Error("transport down");
    }, timers);
    await flush();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_FIRST_RETRY_MS);
    await timers.fire();
    assert.equal(timers.pendingMs(), WEEKLY_USAGE_POLL_MS);
    stop();
  });

  it("stops re-arming after cleanup, even mid-refresh", async () => {
    const timers = makeFakeTimers();
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const stop = startWeeklyUsagePolling(async () => {
      calls += 1;
      await gate;
      return "ok";
    }, timers);
    await flush();
    assert.equal(calls, 1);
    assert.equal(timers.timeouts.size, 0);

    stop();
    release();
    await flush();
    assert.equal(timers.timeouts.size, 0);
    assert.equal(calls, 1);
  });
});

describe("weeklyUsageDelayMs", () => {
  it("keeps the steady cadence while healthy", () => {
    assert.equal(weeklyUsageDelayMs(0), WEEKLY_USAGE_POLL_MS);
    assert.equal(weeklyUsageDelayMs(-1), WEEKLY_USAGE_POLL_MS);
  });

  it("walks the ladder and caps out", () => {
    assert.equal(weeklyUsageDelayMs(1), WEEKLY_USAGE_FIRST_RETRY_MS);
    assert.equal(weeklyUsageDelayMs(2), WEEKLY_USAGE_POLL_MS);
    assert.equal(weeklyUsageDelayMs(3), 60_000);
    assert.equal(weeklyUsageDelayMs(4), 180_000);
    assert.equal(weeklyUsageDelayMs(5), WEEKLY_USAGE_MAX_BACKOFF_MS);
    assert.equal(weeklyUsageDelayMs(99), WEEKLY_USAGE_MAX_BACKOFF_MS);
  });
});
