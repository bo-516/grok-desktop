/**
 * Module-level timer for pending agent mode switches.
 * Kept outside sessionStore / sessionStoreLive so both can share without cycles.
 */

/** Active settle timeout handle, or null when idle. */
let pendingModeTimer: ReturnType<typeof setTimeout> | null = null;

/** Default settle timeout when agent never confirms (ms). */
export const PENDING_MODE_TIMEOUT_MS = 3000;

/**
 * Cancel the pending-mode settle timer if armed.
 * Safe when no timer is running.
 */
export function clearPendingModeTimer(): void {
  if (pendingModeTimer) {
    clearTimeout(pendingModeTimer);
    pendingModeTimer = null;
  }
}

/**
 * Arm a one-shot settle callback after the pending-mode timeout.
 * Replaces any previously armed timer.
 * @param onTimeout Callback when the agent has not confirmed in time.
 */
export function armPendingModeTimeout(onTimeout: () => void): void {
  clearPendingModeTimer();
  pendingModeTimer = setTimeout(() => {
    pendingModeTimer = null;
    onTimeout();
  }, PENDING_MODE_TIMEOUT_MS);
}
