/** Live-turn status strip: Stateful widget + pure view + pure model. */

export { TurnStatusWidget } from "./TurnStatusWidget";
export { TurnStatusView } from "./TurnStatusView";
export type { TurnStatusViewProps } from "./TurnStatusView";
export { useTurnStatusWidget } from "./useTurnStatusWidget";
export {
  resolveTurnStatus,
  turnStartedAtMs,
  TURN_STATUS_DEFAULT_VERB,
  TURN_STATUS_DETAIL_MAX,
} from "./turnStatusModel";
export type { TurnPhase, TurnStatusLine } from "./turnStatusModel";
