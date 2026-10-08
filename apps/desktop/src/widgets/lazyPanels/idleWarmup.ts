/**
 * Idle warm-up for code-split panels.
 *
 * Purpose: the startup bundle no longer parses panel code, but a panel should
 * still open without a load hitch. After first paint, each registered panel
 * chunk is loaded in its own idle slot, one at a time, so the work never
 * lands as one long task while the shell is restoring sessions.
 *
 * Boundary: WKWebView (Wails on macOS) has no `requestIdleCallback`; there a
 * fixed delay stands in. Outside a browser (Node tests / SSR) nothing is
 * scheduled, so importing this module has no side effects in tests.
 */

/** Runs `task` at some later idle moment; must call it at most once. */
export type IdleScheduler = (task: () => void) => void;

/** Ordered, de-duplicated queue of preload functions drained one per idle slot. */
export type WarmupQueue = {
  /**
   * Add a preload to the queue (no-op when already queued or done).
   * @param preload Never-rejecting loader, e.g. LazyPanelLoader.preload.
   */
  enqueue: (preload: () => Promise<void>) => void;
};

/** requestIdleCallback deadline so a busy main thread cannot starve warm-up forever. */
const IDLE_TIMEOUT_MS = 4000;

/** Fallback delay where requestIdleCallback is missing (WKWebView / Safari). */
const IDLE_FALLBACK_DELAY_MS = 1500;

/**
 * Build a warm-up queue on top of an idle scheduler (injectable for tests).
 * @param schedule Defers one drain step; see {@link scheduleWhenIdle}.
 * @returns Queue whose entries run sequentially, each in its own idle slot.
 */
export function createWarmupQueue(schedule: IdleScheduler): WarmupQueue {
  /** Pending preloads in enqueue order. */
  const queue: Array<() => Promise<void>> = [];
  /** Every preload ever enqueued — StrictMode double effects stay idempotent. */
  const seen = new Set<() => Promise<void>>();
  /** Whether a drain step is scheduled or running. */
  const state = { draining: false };

  /** Run the next preload, then yield to the scheduler before the one after. */
  const drain = (): void => {
    const next = queue.shift();
    if (!next) {
      state.draining = false;
      return;
    }
    void next().then(() => schedule(drain));
  };

  return {
    enqueue: (preload) => {
      if (seen.has(preload)) {
        return;
      }
      seen.add(preload);
      queue.push(preload);
      if (!state.draining) {
        state.draining = true;
        schedule(drain);
      }
    },
  };
}

/**
 * Default browser idle scheduler.
 * @param task Work to run when the main thread is idle (or after a delay).
 */
export function scheduleWhenIdle(task: () => void): void {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => task(), { timeout: IDLE_TIMEOUT_MS });
    return;
  }
  window.setTimeout(task, IDLE_FALLBACK_DELAY_MS);
}

/** App-wide panel warm-up queue (browser idle scheduler). */
export const panelWarmupQueue = createWarmupQueue(scheduleWhenIdle);
