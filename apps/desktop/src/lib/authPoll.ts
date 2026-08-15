/**
 * Login-state poll cadence while the live bridge is up.
 * Purpose: `grok login` finishes in a browser and `grok logout` can be run in
 * any terminal — neither pushes an event at us, so the desktop asks. Keeping
 * the cadence here (not inline in the hook) makes it testable with fake timers.
 * Boundary: no store / network; callers pass the probe thunk and host timers.
 */

/**
 * Milliseconds between login-state probes.
 * Matches BRIDGE_RECONNECT_MS so the two background loops tick together
 * instead of interleaving wake-ups. Safe at this rate only because the bridge
 * answers `check_auth` from an env read plus one stat — never a CLI spawn.
 */
export const AUTH_POLL_MS = 3_000;

/**
 * Host interval surface so tests can inject fakes without touching `window`.
 * `T` is the host timer id (`number` in DOM, `Timeout` under @types/node).
 */
export type AuthPollTimers<T = unknown> = {
  /** Arm the repeating probe tick; returns an id `clearInterval` understands. */
  setInterval: (handler: () => void, ms: number) => T;
  /** Cancel the repeating probe tick. */
  clearInterval: (id: T) => void;
};

/**
 * Whether the login poll should be running.
 * Only a live bridge can answer `check_auth`; while disconnected the reconnect
 * loop owns the socket and a probe would be dropped on the floor anyway.
 * @param connectionMode Current session-store connection mode.
 * @returns True when the interval should be armed.
 */
export function shouldArmAuthPoll(connectionMode: string): boolean {
  return connectionMode === "live-bridge";
}

/**
 * Arm the login-state poll: one immediate probe, then every {@link AUTH_POLL_MS}.
 *
 * The leading probe matters on connect — it is what paints the sign-in gate
 * without a three-second blank wait when the user has no credential. `probe`
 * must be cheap and fire-and-forget; the answer arrives asynchronously as an
 * `auth_state` frame, so there is nothing to await and no overlap to guard.
 *
 * @typeParam T Host timer id type (`number` in the browser).
 * @param probe Probe thunk (store `refreshAuth`).
 * @param timers Host interval APIs (`window` in the hook).
 * @returns Cleanup that clears the interval.
 */
export function startAuthPollLoop<T = unknown>(
  probe: () => void,
  timers: AuthPollTimers<T>,
): () => void {
  probe();
  const id = timers.setInterval(probe, AUTH_POLL_MS);
  return () => {
    timers.clearInterval(id);
  };
}
