/**
 * Idle warm-up queue: sequential, de-duplicated, one idle slot per preload.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWarmupQueue } from "@/widgets/lazyPanels/idleWarmup";

/**
 * Manual scheduler: collects tasks so the test decides when "idle" happens.
 * @returns Scheduler plus a `flush` that runs one pending task.
 */
function manualScheduler() {
  const tasks: Array<() => void> = [];
  return {
    schedule: (task: () => void) => {
      tasks.push(task);
    },
    pending: () => tasks.length,
    /** Run the oldest scheduled task, then let its preload promise settle. */
    flush: async () => {
      const task = tasks.shift();
      task?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe("createWarmupQueue", () => {
  it("runs nothing until the scheduler fires, then one preload per slot", async () => {
    const sched = manualScheduler();
    const queue = createWarmupQueue(sched.schedule);
    const ran: string[] = [];
    queue.enqueue(async () => {
      ran.push("a");
    });
    queue.enqueue(async () => {
      ran.push("b");
    });
    assert.deepEqual(ran, []);
    assert.equal(sched.pending(), 1);

    await sched.flush();
    assert.deepEqual(ran, ["a"]);
    await sched.flush();
    assert.deepEqual(ran, ["a", "b"]);
    // Queue drained: the trailing slot finds nothing and stops scheduling.
    await sched.flush();
    assert.equal(sched.pending(), 0);
  });

  it("ignores a preload enqueued twice (StrictMode double effects)", async () => {
    const sched = manualScheduler();
    const queue = createWarmupQueue(sched.schedule);
    let calls = 0;
    const preload = async () => {
      calls += 1;
    };
    queue.enqueue(preload);
    queue.enqueue(preload);
    await sched.flush();
    await sched.flush();
    queue.enqueue(preload);
    assert.equal(sched.pending(), 0);
    assert.equal(calls, 1);
  });
});
