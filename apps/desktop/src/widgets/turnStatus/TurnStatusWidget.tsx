/**
 * Stateful wrapper for the live-turn status strip.
 * Mounted as the last child of the timeline scroller; renders nothing unless a
 * turn is streaming, so finished history has no trailing slot to explain.
 */

import { TurnStatusView } from "./TurnStatusView";
import { useTurnStatusWidget } from "./useTurnStatusWidget";

/**
 * @returns The status strip while the viewed session streams, otherwise null.
 */
export function TurnStatusWidget() {
  const { line, elapsedLabel } = useTurnStatusWidget();
  if (line === null) {
    return null;
  }
  return (
    <TurnStatusView
      verb={line.verb}
      detail={line.detail}
      elapsedLabel={elapsedLabel}
    />
  );
}
