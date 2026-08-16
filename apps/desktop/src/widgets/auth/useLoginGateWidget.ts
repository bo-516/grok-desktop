/**
 * Login gate state: when the signed-out screen replaces the app, and what the
 * button does. Owns only the in-flight flag; `authed` itself lives in the
 * session store, written by the environment probe and the 3s auth poll.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore";

/** State and handlers for {@link LoginGateView}. */
export type LoginGateWidgetState = {
  /** Whether the signed-out screen covers the app. */
  open: boolean;
  /** True while `grok login` is running (button says it is waiting). */
  busy: boolean;
  /** Run `grok login` (opens the browser). */
  onLogin: () => void;
};

/**
 * Compose gate visibility from live connection + login state.
 *
 * Two deliberate gates, in order:
 * - bridge must be live, or we would cover the "bridge not connected" banner
 *   with a sign-in screen and blame the wrong thing;
 * - `authed` must be exactly false — `null` means the first probe has not
 *   answered, and a cold start must not flash the gate at a signed-in user.
 *
 * There is no dismiss: signed out means the app is not shown at all, so the
 * gate closes only when a credential appears (ours or a terminal's `grok
 * login`), and a later `grok logout` brings it straight back.
 *
 * @returns Open/busy flags and the login handler.
 */
export function useLoginGateWidget(): LoginGateWidgetState {
  const authed = useSessionStore((s) => s.authed);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const authLogin = useSessionStore((s) => s.authLogin);

  const [busy, setBusy] = useState(false);
  /** Guards a setState after the gate unmounts mid-login. */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Signed in again (by any route, including a terminal's `grok login` seen by
  // the poll): drop the waiting label so a re-opened gate starts clean.
  useEffect(() => {
    if (authed === true) {
      setBusy(false);
    }
  }, [authed]);

  const onLogin = useCallback(() => {
    setBusy(true);
    void authLogin().finally(() => {
      if (mountedRef.current) {
        setBusy(false);
      }
    });
  }, [authLogin]);

  return {
    open: connectionMode === "live-bridge" && authed === false,
    busy,
    onLogin,
  };
}
