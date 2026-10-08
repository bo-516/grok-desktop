/**
 * Frame scheduling seam for live stream coalescing (liveBridgeCoalesce).
 * Production paints on requestAnimationFrame while the document is visible
 * and falls back to a short timer when rAF is missing or the page is hidden.
 * Tests inject a fake scheduler so frames and timers advance deterministically.
 */

/** Timer stand-in for one frame when rAF is unavailable or the page is hidden (ms). */
export const FRAME_FALLBACK_MS = 16;

/**
 * Watchdog that races every rAF request (ms). rAF stops firing while the
 * window is hidden, so without it a frame requested just before the window
 * hides would hold the last streamed chunk until the window shows again.
 */
export const FRAME_WATCHDOG_MS = 100;

/**
 * Cancels one scheduled callback. Calling it after the callback already ran,
 * or calling it twice, is a no-op.
 */
export type CancelScheduled = () => void;

/**
 * Injectable scheduling primitives used by the stream coalescer.
 * Both methods must run `cb` at most once and never synchronously.
 */
export type StreamFrameScheduler = {
  /**
   * Run `cb` on the next paint frame (or its timer stand-in).
   * @param cb Frame work; receives no arguments.
   * @returns Cancel handle; cancelling before the frame drops `cb`.
   */
  requestFrame: (cb: () => void) => CancelScheduled;
  /**
   * Run `cb` after roughly `ms` milliseconds (background lane).
   * @param cb Deferred work.
   * @param ms Delay in milliseconds; negative values behave like 0.
   * @returns Cancel handle; cancelling before the delay elapses drops `cb`.
   */
  delay: (cb: () => void, ms: number) => CancelScheduled;
};

/** Timer id type shared by DOM and Node typings. */
type TimerId = ReturnType<typeof setTimeout>;

/**
 * Browser globals the default scheduler reads. Injectable so tests can check
 * the rAF / hidden / fallback choice without a DOM.
 */
export type FrameSchedulerEnv = {
  /** Missing (undefined) in Node and some embedded webviews → timer fallback. */
  requestAnimationFrame?: (cb: () => void) => number;
  /** Must be present together with requestAnimationFrame, else timer fallback. */
  cancelAnimationFrame?: (id: number) => void;
  /** Timer used for the fallback frame, the rAF watchdog and `delay`. */
  setTimeout: (cb: () => void, ms: number) => TimerId;
  /** Clears a timer created through `setTimeout`. */
  clearTimeout: (id: TimerId) => void;
  /** `visibilityState === "hidden"` switches frames to the timer fallback. */
  document?: { visibilityState?: string };
};

/**
 * Read the real globals lazily. rAF is bound only when the runtime has it.
 * @returns Env for createFrameScheduler; never throws in Node.
 */
function readGlobalEnv(): FrameSchedulerEnv {
  /** Global object viewed with optional DOM members (absent under Node). */
  const g = globalThis as typeof globalThis & {
    requestAnimationFrame?: (cb: () => void) => number;
    cancelAnimationFrame?: (id: number) => void;
    document?: { visibilityState?: string };
  };
  /** Native rAF pair; undefined under Node. Called with `g` as receiver. */
  const raf = g.requestAnimationFrame;
  const caf = g.cancelAnimationFrame;
  /** Present only in browsers / webviews. */
  const hasRaf = typeof raf === "function" && typeof caf === "function";
  return {
    requestAnimationFrame: hasRaf ? (cb) => raf.call(g, cb) : undefined,
    cancelAnimationFrame: hasRaf ? (id) => caf.call(g, id) : undefined,
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    get document() {
      return g.document;
    },
  };
}

/**
 * Create the production frame scheduler.
 * Visible page with rAF → rAF raced by a FRAME_WATCHDOG_MS timer (first one
 * wins, the other is cancelled). Hidden page or no rAF → FRAME_FALLBACK_MS timer.
 * @param env Globals to use; defaults to the real browser / Node globals.
 * @returns Scheduler whose callbacks run at most once each.
 */
export function createFrameScheduler(
  env: FrameSchedulerEnv = readGlobalEnv(),
): StreamFrameScheduler {
  /**
   * Plain timer wrapped as a cancel handle.
   * @param cb Work to run once.
   * @param ms Delay in milliseconds.
   */
  function delay(cb: () => void, ms: number): CancelScheduled {
    const id = env.setTimeout(cb, Math.max(0, ms));
    return () => env.clearTimeout(id);
  }

  /**
   * Next paint frame, or a timer when rAF cannot be trusted to fire.
   * @param cb Frame work to run once.
   */
  function requestFrame(cb: () => void): CancelScheduled {
    const raf = env.requestAnimationFrame;
    const caf = env.cancelAnimationFrame;
    if (!raf || !caf || env.document?.visibilityState === "hidden") {
      return delay(cb, FRAME_FALLBACK_MS);
    }
    /** Race bookkeeping: whichever of rAF / watchdog fires first wins. */
    const race: { done: boolean; rafId?: number; timerId?: TimerId } = {
      done: false,
    };
    /**
     * Stop both racers; returns false when the race was already settled.
     */
    const settle = (): boolean => {
      if (race.done) {
        return false;
      }
      race.done = true;
      if (race.rafId !== undefined) {
        caf(race.rafId);
      }
      if (race.timerId !== undefined) {
        env.clearTimeout(race.timerId);
      }
      return true;
    };
    /** Shared firing path for both racers. */
    const fire = (): void => {
      if (settle()) {
        cb();
      }
    };
    race.rafId = raf(fire);
    race.timerId = env.setTimeout(fire, FRAME_WATCHDOG_MS);
    return () => {
      settle();
    };
  }

  return { requestFrame, delay };
}
