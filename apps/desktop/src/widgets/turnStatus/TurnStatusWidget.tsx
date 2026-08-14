/**
 * Stateful wrapper for the live-turn status strip.
 * Mounted in the composer dock (above the input card), not inside the
 * timeline scroller — a sticky child of that scroller painted through the
 * streaming answer. Renders nothing unless a turn is streaming.
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
