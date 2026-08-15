/**
 * Stateful entry for the signed-out gate: connects the store hook to the view.
 * Mounted unconditionally by App; the hook decides whether anything paints.
 */

import { LoginGateView } from "./LoginGateView";
import { useLoginGateWidget } from "./useLoginGateWidget";

/**
 * Render the sign-in modal when the bridge is live and no credential exists.
 * @returns LoginGateView wired to store auth state (null while signed in).
 */
export function LoginGateWidget() {
  const gate = useLoginGateWidget();
  return (
    <LoginGateView
      open={gate.open}
      busy={gate.busy}
      onLogin={gate.onLogin}
      onDismiss={gate.onDismiss}
    />
  );
}
