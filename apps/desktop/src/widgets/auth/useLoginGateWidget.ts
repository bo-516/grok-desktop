/**
 * Onboarding gate state: when the onboarding screen replaces the app, which
 * step it shows (install / fix / update the grok CLI, or sign in), and which
 * action the environment banner offers. Owns only UI flags (login in flight,
 * a deferred advisory step, a pending re-probe); `authed` and `environment`
 * live in the session store, written by the probes and the 3s auth poll.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EnvironmentInfo } from "@/bridge/liveBridgeTypes";
import {
  envBannerAction,
  isDeferrableStep,
  onboardingStep,
  type EnvBannerActionKind,
  type OnboardingStep,
} from "@/lib/grokOnboarding";
import { useSessionStore } from "@/store/sessionStore";
import type { LoginGateViewProps } from "./LoginGateView";

/** Banner button wired to its handler. */
export type GateBannerAction = {
  /** Button text, matched to the failure. */
  label: string;
  /** Sign in, re-probe, or reopen the onboarding screen. */
  onAction: () => void;
};

/** State and handlers for {@link LoginGateView} and the shell banner. */
export type LoginGateWidgetState = {
  /** Whether the onboarding screen covers the app (App marks the shell inert). */
  open: boolean;
  /** Props for LoginGateView. */
  view: LoginGateViewProps;
  /** Action for the environment banner; null when it should show no button. */
  bannerAction: GateBannerAction | null;
};

/**
 * Compose gate visibility, step, and banner action from live state.
 *
 * Gates, in order:
 * - bridge must be live, or we would cover the "bridge not connected" banner
 *   with the onboarding screen and blame the wrong thing;
 * - a step must exist (see onboardingStep): a CLI failure kind from the last
 *   probe, or `authed` exactly false — `null` means the first probe has not
 *   answered, and a cold start must not flash the gate at a signed-in user;
 * - an advisory step (old / unreadable / slow CLI) the user set aside with
 *   "Continue anyway" stays closed until the step changes or the banner's
 *   action reopens it. Missing CLI and signed-out cannot be set aside.
 *
 * Every step ends in a fresh `check_environment` (Check again, a finished
 * setup run, a saved path, a login), so the screen follows the machine.
 *
 * @returns Open flag, view props, and the banner action.
 */
export function useLoginGateWidget(): LoginGateWidgetState {
  const authed = useSessionStore((s) => s.authed);
  const connectionMode = useSessionStore((s) => s.connectionMode);
  const environment = useSessionStore((s) => s.environment);
  const authLogin = useSessionStore((s) => s.authLogin);
  const refreshEnvironment = useSessionStore((s) => s.refreshEnvironment);

  const [busy, setBusy] = useState(false);
  /** Advisory step set aside by "Continue anyway"; null when none. */
  const [deferredStep, setDeferredStep] = useState<OnboardingStep | null>(
    null,
  );
  /**
   * Environment snapshot a re-probe was requested against. The probe answers
   * with a new object, so "still the same object" means "still checking".
   * undefined when no re-probe is pending.
   */
  const [recheckFrom, setRecheckFrom] = useState<
    EnvironmentInfo | null | undefined
  >(undefined);
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

  const onRecheck = useCallback(() => {
    setRecheckFrom(environment);
    refreshEnvironment();
  }, [environment, refreshEnvironment]);

  const step = onboardingStep(environment, authed);
  const deferrable = isDeferrableStep(step);
  const open =
    connectionMode === "live-bridge" &&
    step !== null &&
    !(deferrable && deferredStep === step);
  const banner = envBannerAction(environment);
  const bannerHandlers: Record<EnvBannerActionKind, () => void> = {
    login: onLogin,
    retry: refreshEnvironment,
    setup: () => setDeferredStep(null),
  };

  return {
    open,
    view: {
      open,
      step,
      env: environment,
      busy,
      onLogin,
      rechecking: recheckFrom !== undefined && recheckFrom === environment,
      onRecheck,
      deferrable,
      onDefer: () => setDeferredStep(step),
    },
    bannerAction: banner
      ? { label: banner.label, onAction: bannerHandlers[banner.kind] }
      : null,
  };
}
