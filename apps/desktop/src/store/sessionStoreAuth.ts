/**
 * Login / logout actions and the auth-probe reducer.
 * Purpose: keep `authed` — the flag the login gate renders from — honest no
 * matter how the credential changed (our own buttons, a browser login the CLI
 * finished after our request timed out, or `grok logout` in a terminal).
 * Boundary: owns no UI state; the bridge is the only source of truth, this
 * module just decides when to ask it again.
 */

import type { AuthProbe, EnvironmentInfo } from "../bridge/liveBridge";
import type { SessionStoreGet, SessionStoreSet } from "./sessionStoreTypes";

/**
 * Minimal get shape the probe reducer needs. Structural (like PendingGet in
 * sessionStorePending) so this module stays out of the LiveStoreSlice cycle
 * and can be called from both the live-bridge handlers and the full store.
 */
type AuthProbeGet = () => {
  /** Previous login flag; null before the first probe of this connection. */
  authed?: boolean | null;
  /**
   * Bridge handle, narrowed to the one method this reducer calls. Structural
   * rather than {@link LiveHandle} so tests can pass a two-field double.
   */
  live?: { checkEnvironment: () => unknown } | null;
  [key: string]: unknown;
};

/**
 * Minimal set shape: the Zustand partial form without importing SetState.
 * @param partial Patch object (this reducer never uses the updater form).
 */
type AuthProbeSet = (partial: Record<string, unknown>) => void;

/**
 * Apply one `auth_state` tick from the 3s poll.
 *
 * Two things happen on a real change and neither on a repeat: `authed` flips
 * (the gate opens or closes), and a full `check_environment` is requested so
 * the banner message, CLI path, and version stop describing the old state.
 * Repeat ticks write nothing at all — this runs every 3 seconds and a `set`
 * per tick would wake every store subscriber twenty times a minute.
 *
 * @param set Zustand set — only called on an actual change of `authed`.
 * @param get Zustand get — reads the previous flag and the live handle.
 * @param auth Probe payload from the bridge (`authed` is all we key on).
 */
export function applyAuthProbe(
  set: AuthProbeSet,
  get: AuthProbeGet,
  auth: AuthProbe,
): void {
  const previous = get().authed ?? null;
  if (previous === auth.authed) {
    return;
  }
  set({ authed: auth.authed });
  // First probe after connect is not a login/logout event — the environment
  // request that follows `live.ready` already covers it.
  if (previous === null) {
    return;
  }
  get().live?.checkEnvironment();
}

/**
 * Adopt login state carried by a full environment probe.
 * Keeps the two messages from disagreeing: whichever answer lands last wins,
 * and both write the same field.
 * @param env Environment payload from `check_environment`.
 * @returns The flag to store alongside the environment snapshot.
 */
export function authedFromEnvironment(env: EnvironmentInfo): boolean {
  return env.authed === true;
}

/**
 * Run `grok login` through the CLI channel and re-probe on return.
 *
 * The CLI blocks until the browser round-trip finishes, which can outlast the
 * client's 120s request timeout — a rejection here therefore does not mean
 * login failed, only that we stopped waiting. The 3s poll is what actually
 * closes the gate; this just makes the common case instant.
 *
 * @param set Unused directly (probe writes through `applyAuthProbe`).
 * @param get Zustand get — needs `runCli` and the live handle.
 * @returns True only when the CLI exited 0 within the request window.
 */
export async function authLoginAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): Promise<boolean> {
  void set;
  try {
    const result = await get().runCli("auth_login");
    get().refreshAuth();
    get().refreshEnvironment();
    return result.ok;
  } catch {
    // Timed out waiting on the browser — the poll will catch the credential.
    get().refreshAuth();
    return false;
  }
}

/**
 * Run `grok logout` through the CLI channel and re-probe on return.
 * The bridge disposes every pooled runtime on success (F-AUTH-07), so the
 * canvas session is gone afterwards whatever this resolves to.
 * @param set Unused directly (probe writes through `applyAuthProbe`).
 * @param get Zustand get — needs `runCli` and the live handle.
 * @returns True when the CLI reported success.
 */
export async function authLogoutAction(
  set: SessionStoreSet,
  get: SessionStoreGet,
): Promise<boolean> {
  void set;
  try {
    const result = await get().runCli("auth_logout");
    get().refreshAuth();
    get().refreshEnvironment();
    return result.ok;
  } catch {
    get().refreshAuth();
    return false;
  }
}
