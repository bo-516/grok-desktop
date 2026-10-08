/**
 * Auth widget surface: the onboarding / sign-in screen (install, fix or
 * update the grok CLI, then sign in) and its banner action.
 * Upper layers import from `@/widgets/auth`, never the files inside.
 * App pairs the hook with the view itself — the gate's open flag also decides
 * whether the shell renders inert, so no wrapper component can own it alone.
 */

export { LoginGateView } from "./LoginGateView";
export type { LoginGateViewProps } from "./LoginGateView";
export { useLoginGateWidget } from "./useLoginGateWidget";
export type {
  GateBannerAction,
  LoginGateWidgetState,
} from "./useLoginGateWidget";
export { OnboardingStepView } from "./OnboardingStepView";
export type { OnboardingStepViewProps } from "./OnboardingStepView";
export { OnboardingSetupWidget } from "./OnboardingSetupWidget";
export type { OnboardingSetupWidgetProps } from "./OnboardingSetupWidget";
