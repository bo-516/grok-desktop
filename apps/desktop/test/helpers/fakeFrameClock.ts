/**
 * Deterministic frame + timer clock for stream coalescing tests.
 * Virtual time advances in 1 ms steps; due timers fire first, then every
 * `frameMs` boundary runs all queued frame callbacks (one vsync).
 */

import type {
  CancelScheduled,
  StreamFrameScheduler,
} from "@/bridge/liveBridgeFrameScheduler";

/** Fake clock handle returned by createFakeFrameClock. */
export type FakeFrameClock = {
  /** Scheduler to inject into createLiveBridgeDispatch / createStreamCoalescer. */
  scheduler: StreamFrameScheduler;
  /**
   * Advance virtual time, firing due timers and frame boundaries in order.
   * @param ms Milliseconds to advance (integer ≥ 0).
   */
  advance: (ms: number) => void;
  /** Current virtual time (ms). */
  now: () => number;
  /** Number of frame boundaries crossed so far (vsync counter). */
  frameIndex: () => number;
  /** Frame callbacks currently queued. */
  queuedFrames: () => number;
  /** Timers currently armed. */
  armedTimers: () => number;
};

/** One armed fake timer. */
type FakeTimer = { id: number; due: number; cb: () => void };

/**
 * Create a fake clock.
 * @param frameMs Frame period in ms (default 16 ≈ 60 Hz).
 * @returns Clock plus its injectable scheduler.
 */
export function createFakeFrameClock(frameMs = 16): FakeFrameClock {
  const timers = new Map<number, FakeTimer>();
  const frames = new Map<number, () => void>();
  const state = { now: 0, seq: 0, frameIndex: 0 };

  /** Fire every timer due at the current time, earliest (then oldest) first. */
  function fireDueTimers(): void {
    for (;;) {
      const due = [...timers.values()]
        .filter((t) => t.due <= state.now)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!due) {
        return;
      }
      timers.delete(due.id);
      due.cb();
    }
  }

  /** Run one vsync: callbacks queued before it started. */
  function runFrame(): void {
    state.frameIndex += 1;
    const batch = [...frames.entries()];
    frames.clear();
    for (const [, cb] of batch) {
      cb();
    }
  }

  const scheduler: StreamFrameScheduler = {
    requestFrame: (cb): CancelScheduled => {
      state.seq += 1;
      const id = state.seq;
      frames.set(id, cb);
      return () => {
        frames.delete(id);
      };
    },
    delay: (cb, ms): CancelScheduled => {
      state.seq += 1;
      const id = state.seq;
      timers.set(id, { id, due: state.now + Math.max(0, ms), cb });
      return () => {
        timers.delete(id);
      };
    },
  };

  return {
    scheduler,
    advance: (ms) => {
      const target = state.now + ms;
      while (state.now < target) {
        state.now += 1;
        fireDueTimers();
        if (state.now % frameMs === 0) {
          runFrame();
        }
      }
    },
    now: () => state.now,
    frameIndex: () => state.frameIndex,
    queuedFrames: () => frames.size,
    armedTimers: () => timers.size,
  };
}
