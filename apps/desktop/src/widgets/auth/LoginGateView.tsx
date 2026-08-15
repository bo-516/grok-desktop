/**
 * Signed-out gate: app logo, one sign-in action, and the fallback hint.
 * Presentation only — the parent owns visibility, busy state, and callbacks.
 * While mounted it behaves like the app's other modals: focus lands inside,
 * Tab is trapped, Escape dismisses (the shell banner stays as the way back).
 */

import { useEffect, useLayoutEffect, useId, useRef, type MouseEvent } from "react";
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
  /** Dismiss without signing in (Escape, backdrop, or "Not now"). */
  onDismiss: () => void;
};

/**
 * Modal sign-in surface; returns null when closed.
 * Hooks always run (open gated inside effects) so focus restore stays valid.
 * The logo is an `<img>` from the shared app-icon asset — the same mark the
 * dock/taskbar shows, so the gate reads as this app asking, not a web page.
 * @param props Open/busy flags, credential path, and the two handlers.
 * @returns Backdrop + panel, or null while signed in.
 */
export function LoginGateView(props: LoginGateViewProps) {
  const { open, busy, onLogin, onDismiss } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  /** Element that held focus before the gate opened. */
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const descId = `${reactId}-desc`;

  // Enter: remember prior focus and land on the first control.
  // Exit: restore prior focus when the node is still connected.
  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    focusInitialIn(panelRef.current);
    return () => {
      restoreFocus(previousFocusRef.current);
      previousFocusRef.current = null;
    };
  }, [open]);

  // Capture-phase Escape → dismiss (wins over side-panel Escape handlers).
  // Tab cycles inside the dialog panel.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onDismiss();
        return;
      }
      const panel = panelRef.current;
      if (panel) {
        trapFocusTab(e, panel);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onDismiss]);

  if (!open) {
    return null;
  }

  /**
   * Backdrop click dismisses; clicks on the panel itself must not bubble.
   * @param e Click on the dimmed overlay
   */
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) {
      return;
    }
    onDismiss();
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <FadeContent immediate durationMs={240}>
        <div
          ref={panelRef}
          className="modal-panel login-gate"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descId}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <img className="login-gate-logo" src={logoUrl} alt="" />
          <h2 id={titleId} className="modal-title login-gate-title">
            Sign in to Grok
          </h2>
          <p id={descId} className="login-gate-copy">
            Grok Desktop runs the local grok CLI, and that CLI has no
            credential yet. Signing in opens your browser; this window updates
            on its own once it succeeds.
          </p>
          <div className="login-gate-actions">
            <button
              type="button"
              className="btn btn-primary login-gate-primary"
              disabled={busy}
              onClick={onLogin}
            >
              {busy ? "Waiting for browser…" : "Open login page"}
            </button>
            <button type="button" className="btn-ghost" onClick={onDismiss}>
              Not now
            </button>
          </div>
          {/* One line, no path: the full auth.json location wrapped to four
              lines here and buried the actions. It lives in Settings. */}
          <p className="login-gate-hint">
            Or set XAI_API_KEY before launching the app.
          </p>
        </div>
      </FadeContent>
    </div>
  );
}
