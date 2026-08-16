/**
 * Signed-out screen: app logo, one sign-in action, and the fallback hint.
 * Presentation only — the parent owns visibility, busy state, and the callback.
 * This is not a modal: while signed out it *is* the window, painted on the
 * opaque app background, with no dismiss and no way past it. The shell behind
 * stays mounted (it drives the 3s login poll) but the parent marks it inert,
 * so nothing of the real UI is visible, clickable, or reachable by Tab.
 */

import { useEffect, useLayoutEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FadeContent } from "@/components/react-bits";
import { focusInitialIn, restoreFocus, trapFocusTab } from "@/lib/focusTrap";
import logoUrl from "@/assets/app-logo.svg";

export type LoginGateViewProps = {
  /** When false the view returns null; focus restore still runs on the close edge. */
  open: boolean;
  /**
   * True while `grok login` is running. The CLI does not return until the
   * browser round-trip ends, so the button has to say it is waiting rather
   * than look ignored.
   */
  busy: boolean;
  /** Open the browser login page (runs `grok login` on the bridge host). */
  onLogin: () => void;
};

/**
 * Full-window sign-in surface; returns null when closed.
 * Hooks always run (open gated inside effects) so focus restore stays valid.
 * The logo is an `<img>` from the shared app-icon asset — the same mark the
 * dock/taskbar shows, so the gate reads as this app asking, not a web page.
 * @param props Open/busy flags and the login handler.
 * @returns The signed-out screen, or null once a credential exists.
 */
export function LoginGateView(props: LoginGateViewProps) {
  const { open, busy, onLogin } = props;
  const screenRef = useRef<HTMLDivElement>(null);
  /** Element that held focus before the gate opened. */
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const descId = `${reactId}-desc`;

  // Enter: remember prior focus and land on the sign-in button.
  // Exit: restore prior focus when the node is still connected.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    focusInitialIn(screenRef.current);
    return () => {
      restoreFocus(previousFocusRef.current);
      previousFocusRef.current = null;
    };
  }, [open]);

  // Tab cycles inside the screen. Escape is deliberately not handled: there is
  // nothing to dismiss to — signing in is the only way forward, quitting the
  // window the only way out.
  // The shell behind is inert, but its shortcuts are window listeners and fire
  // regardless; swallowing modifier chords here stops ⌘K / ⌘N / ⌘, from opening
  // chrome blind behind the gate and having it appear the moment you sign in.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const screen = screenRef.current;
      if (screen && trapFocusTab(e, screen)) {
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  if (!open) {
    return null;
  }

  // Portaled to <body>: App marks the shell `inert` while this is up, and a
  // gate rendered inside that subtree would inherit the block on its own button.
  const screen = (
    <div
      ref={screenRef}
      className="login-gate-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
    >
      <FadeContent immediate durationMs={240} className="login-gate">
        <img className="login-gate-logo" src={logoUrl} alt="" />
        <h1 id={titleId} className="login-gate-title">
          Sign in to Grok
        </h1>
        <p id={descId} className="login-gate-copy">
          Grok Desktop runs the local grok CLI, and that CLI has no credential
          yet. Signing in opens your browser; this window unlocks on its own
          once it succeeds.
        </p>
        <button
          type="button"
          className="btn btn-primary login-gate-primary"
          disabled={busy}
          onClick={onLogin}
        >
          {busy ? "Waiting for browser…" : "Open login page"}
        </button>
        {/* One line, no path: the full auth.json location wrapped to four
            lines here and buried the action. It lives in Settings. */}
        <p className="login-gate-hint">
          Or set XAI_API_KEY before launching the app.
        </p>
      </FadeContent>
    </div>
  );

  return createPortal(screen, document.body);
}
