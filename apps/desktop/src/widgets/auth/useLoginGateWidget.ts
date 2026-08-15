/**
 * Login gate state: when the signed-out modal shows, and what the button does.
 * Owns only the dismiss latch and the in-flight flag; `authed` itself lives in
 * the session store, written by the environment probe and the 3s auth poll.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/store/sessionStore";

/** State and handlers for {@link LoginGateView}. */
export type LoginGateWidgetState = {
  /** Whether the modal should be mounted. */
  open: boolean;
  /** True while `grok login` is running (button says it is waiting). */
  busy: boolean;
  /** Run `grok login` (opens the browser). */
  onLogin: () => void;
  /** Close without signing in; re-opens if the user signs out again later. */
  onDismiss: () => void;
};

/**
 * Compose gate visibility from live connection + login state.
 *
 * Three deliberate gates, in order:
 * - bridge must be live, or we would stack a sign-in modal on top of the
 *   "bridge not connected" banner and blame the wrong thing;
 * - `authed` must be exactly false — `null` means the first probe has not
 *   answered, and a cold start must not flash the modal;
 * - the user must not have dismissed it for this signed-out stretch.
 *
 * The dismiss latch clears whenever a credential appears, so a later `grok
 * logout` (ours or a terminal's) brings the gate back rather than leaving the
 * app silently unusable.
 *
 * @returns Open/busy flags and both handlers.
 */
export function useLoginGateWidget(): LoginGateWidgetState {
  const authed = useSessionStore((s) => s.authed);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const authLogin = useSessionStore((s) => s.authLogin);

  /** True once the user closed the gate during this signed-out stretch. */
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Guards a setState after the modal unmounts mid-login. */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Signed in again (by any route): re-arm the gate for the next sign-out.
  useEffect(() => {
    if (authed === true) {
      setDismissed(false);
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

  const onDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return {
    open:
      connectionMode === "live-bridge" && authed === false && !dismissed,
    busy,
    onLogin,
    onDismiss,
  };
}
