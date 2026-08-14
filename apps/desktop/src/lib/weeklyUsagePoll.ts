/**
 * Account-level weekly remaining refresh schedule.
 * Purpose: `_x.ai/billing` is not session-scoped, so the composer polls on a
 * fixed interval instead of waiting on turn_completed. Consecutive failures
 * widen the delay so a proxy / network outage costs a handful of RPCs instead
 * of one every 20s (each failed poll also logs an agent-side ERROR line).
 * Boundary: no store / network; callers pass the refresh thunk and host timers.
 */

/** Milliseconds before the retry that follows the first failed poll. */
export const WEEKLY_USAGE_FIRST_RETRY_MS = 2_000;

/** Milliseconds between account billing polls while the chip is eligible. */
export const WEEKLY_USAGE_POLL_MS = 20_000;

/** Ceiling for the failure backoff; a long outage still retries this often. */
export const WEEKLY_USAGE_MAX_BACKOFF_MS = 300_000;

/**
 * Delay ladder indexed by consecutive failures. Step 1 keeps the quick
 * first-connect retry (a just-spawned process often cannot answer billing yet);
 * later steps widen so an offline stretch stops hammering the agent.
 */
export const WEEKLY_USAGE_BACKOFF_LADDER_MS: readonly number[] = [
  WEEKLY_USAGE_FIRST_RETRY_MS,
  WEEKLY_USAGE_POLL_MS,
  60_000,
  180_000,
  WEEKLY_USAGE_MAX_BACKOFF_MS,
];

/**
 * Outcome of one refresh, used to pace the next poll.
 * `skip` is a no-op (disconnected / already in flight) and leaves the cadence
 * where it was; only `fail` widens it and only `ok` resets it.
 */
export type WeeklyUsageOutcome = "ok" | "fail" | "skip";

/** Host timer surface so tests can inject fakes without touching `window`. */
export type WeeklyUsagePollTimers = {
  /** Schedule the next poll; returns an id `clearTimeout` understands. */
  setTimeout: (handler: () => void, ms: number) => number;
  /** Cancel the pending poll. */
  clearTimeout: (id: number) => void;
};

/**
 * Delay before the next poll given the consecutive-failure count.
 * @param failures Consecutive `fail` outcomes; 0 means the last poll was healthy.
 * @returns {@link WEEKLY_USAGE_POLL_MS} while healthy, else the ladder step.
 */
export function weeklyUsageDelayMs(failures: number): number {
  if (failures <= 0) {
    return WEEKLY_USAGE_POLL_MS;
  }
  const step = Math.min(failures, WEEKLY_USAGE_BACKOFF_LADDER_MS.length) - 1;
  return WEEKLY_USAGE_BACKOFF_LADDER_MS[step] ?? WEEKLY_USAGE_MAX_BACKOFF_MS;
}

/**
 * Fire immediately, then re-arm from each settled refresh: steady cadence while
 * healthy, widening ladder while failing. Exactly one timer is pending at a
 * time, so a slow RPC cannot stack polls.
 * @param refresh Store action that hits `_x.ai/billing`.
 * @param timers Host `setTimeout` / `clearTimeout` (window in the hook).
 * @returns Cleanup that cancels the pending poll and stops re-arming.
 */
export function startWeeklyUsagePolling(
  refresh: () => Promise<WeeklyUsageOutcome>,
  timers: WeeklyUsagePollTimers,
): () => void {
  let stopped = false;
  let failures = 0;
  let pending: number | null = null;

  /** Run one refresh, then schedule the next from its outcome. */
  const tick = async (): Promise<void> => {
    pending = null;
    /** A thrown refresh paces like a failed one — back off, never stop. */
    let outcome: WeeklyUsageOutcome = "fail";
    try {
      outcome = await refresh();
    } catch {
      // Keep the default `fail` pacing.
    }
    if (stopped) {
      return;
    }
    if (outcome === "ok") {
      failures = 0;
    } else if (outcome === "fail") {
      failures += 1;
    }
    pending = timers.setTimeout(() => {
      void tick();
    }, weeklyUsageDelayMs(failures));
  };

  void tick();
  return () => {
    stopped = true;
    if (pending !== null) {
      timers.clearTimeout(pending);
      pending = null;
    }
  };
}
