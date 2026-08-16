/**
 * Auth widget surface: the signed-out login screen.
 * Upper layers import from `@/widgets/auth`, never the files inside.
 * App pairs the hook with the view itself — the gate's open flag also decides
 * whether the shell renders inert, so no wrapper component can own it alone.
 */

export { LoginGateView } from "./LoginGateView";
export type { LoginGateViewProps } from "./LoginGateView";
export { useLoginGateWidget } from "./useLoginGateWidget";
export type { LoginGateWidgetState } from "./useLoginGateWidget";
