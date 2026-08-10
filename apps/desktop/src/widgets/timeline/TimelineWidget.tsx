/**
 * Stateful chat timeline: store + find + scroll via useTimelineWidget,
 * pure presentation via TimelineView.
 */

import { TimelineView } from "./TimelineView";
import { useTimelineWidget } from "./useTimelineWidget";

/**
 * Mount point for the session timeline canvas.
 * @returns Timeline surface bound to the live session store.
 */
export function TimelineWidget() {
  const model = useTimelineWidget();
  return <TimelineView {...model} />;
}
