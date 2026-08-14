/**
 * Wrapper around a compact child timeline (Stateless).
 * Isolated so tests can render the frame without mounting Streamdown.
 * `agents-transcript-wrap` is the height-bounded flex parent; the child
 * `.timeline` is the overflow-y scroller (stick-to-bottom lives there).
 */

import type { ReactNode } from "react";

export type SubagentTimelineFrameViewProps = {
  /** Which resolver level produced this snapshot. */
  source: "live" | "cached";
  /** Compact TimelineView (or a test stand-in of the same snapshot text). */
  children?: ReactNode;
};

/**
 * Marks the live/cached inspect body. Never renders an empty element.
 * @param props Source kind + body.
 * @returns Frame with `data-agents-body` for tests and density CSS.
 */
export function SubagentTimelineFrameView(
  props: SubagentTimelineFrameViewProps,
) {
  return (
    <div className="agents-transcript-wrap" data-agents-body={props.source}>
      {props.children}
    </div>
  );
}
