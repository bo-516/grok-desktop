/**
 * Module-level timer for pending agent mode switches.
 * Kept outside sessionStore / sessionStoreLive so both can share without cycles.
 */

/** Active settle timeout handle, or null when idle. */
let pendingModeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Give up on session/set_mode when grok-build never finishes (ms).
 * This is a failure, not a success: the chip reverts and a held prompt is not sent.
 */
export const PENDING_MODE_TIMEOUT_MS = 15_000;

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
 * Arm a one-shot failure callback after the pending-mode timeout.
 * Replaces any previously armed timer. The callback must revert; it must not
 * treat silence as a successful mode switch.
 * @param onTimeout Callback when session/set_mode has not finished in time.
 */
export function armPendingModeTimeout(onTimeout: () => void): void {
  clearPendingModeTimer();
  pendingModeTimer = setTimeout(() => {
    pendingModeTimer = null;
    onTimeout();
  }, PENDING_MODE_TIMEOUT_MS);
}
