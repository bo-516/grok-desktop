/**
 * Onboarding screen: app logo plus the current step — install / fix / update
 * the grok CLI, or sign in (see OnboardingStepView).
 * Presentation only — the parent owns visibility, the step, and the callbacks.
 * This is not a modal: while it is up it *is* the window, painted on the
 * opaque app background. Missing CLI and signed-out have no way past it; the
 * advisory steps (old / unreadable / slow CLI) offer "Continue anyway". The
 * shell behind stays mounted (it drives the 3s login poll) but the parent
 * marks it inert, so nothing of the real UI is visible, clickable, or
 * reachable by Tab.
 */

import cs from "classnames";
import { useEffect, useLayoutEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { EnvironmentInfo } from "@/bridge/liveBridgeTypes";
import { FadeContent } from "@/components/react-bits";
import { focusInitialIn, restoreFocus, trapFocusTab } from "@/lib/focusTrap";
import type { OnboardingStep } from "@/lib/grokOnboarding";
import logoUrl from "@/assets/app-logo.svg";
import { OnboardingStepView } from "./OnboardingStepView";

export type LoginGateViewProps = {
  /** When false the view returns null; focus restore still runs on the close edge. */
  open: boolean;
  /** Step to show; null renders nothing even when open is true. */
  step: OnboardingStep | null;
  /** Latest environment probe (message, versions, setup commands). */
  env: EnvironmentInfo | null;
  /**
   * True while `grok login` is running. The CLI does not return until the
   * browser round-trip ends, so the button has to say it is waiting rather
   * than look ignored.
   */
  busy: boolean;
  /** Open the browser login page (runs `grok login` on the bridge host). */
  onLogin: () => void;
  /** True while a requested re-probe has not answered. */
  rechecking: boolean;
  /** Re-run check_environment. */
  onRecheck: () => void;
  /** Whether the step may be set aside ("Continue anyway"). */
  deferrable: boolean;
  /** Set the advisory step aside; the banner keeps offering it. */
  onDefer: () => void;
};

/**
 * Full-window onboarding surface; returns null when closed or without a step.
 * Hooks always run (open gated inside effects) so focus restore stays valid.
 * The logo is an `<img>` from the shared app-icon asset — the same mark the
 * dock/taskbar shows, so the gate reads as this app asking, not a web page.
 * @param props Open flag, step, probe, and the step handlers.
 * @returns The onboarding screen, or null once the CLI is ready and signed in.
 */
export function LoginGateView(props: LoginGateViewProps) {
  const { open, step } = props;
  const screenRef = useRef<HTMLDivElement>(null);
  /** Element that held focus before the gate opened. */
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const descId = `${reactId}-desc`;

  // Enter: remember prior focus and land on the step's first control.
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
  // nothing to dismiss to — finishing the step (or "Continue anyway" where it
  // is offered) is the only way forward, quitting the window the only way out.
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

  if (!open || step === null) {
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
      <FadeContent
        immediate
        durationMs={240}
        className={cs("login-gate", {
          "login-gate-wide": step !== "signed_out" && step !== "checking",
        })}
      >
        <img className="login-gate-logo" src={logoUrl} alt="" />
        <OnboardingStepView
          step={step}
          env={props.env}
          titleId={titleId}
          descId={descId}
          busy={props.busy}
          onLogin={props.onLogin}
          rechecking={props.rechecking}
          onRecheck={props.onRecheck}
          deferrable={props.deferrable}
          onDefer={props.onDefer}
        />
      </FadeContent>
    </div>
  );

  return createPortal(screen, document.body);
}
