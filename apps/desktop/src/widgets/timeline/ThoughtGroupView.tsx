/**
 * Collapsed consecutive Thought segments (symmetric to ToolGroupView).
 * Expand shows each segment body separated so multi-step reasoning stays readable.
 */

import cs from "classnames";
import { useState } from "react";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { formatThoughtGroupLabel } from "@/lib/thoughtLabel";
import type { ThoughtGroupUnit } from "@/lib/thoughtGrouping";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

type ThoughtGroupViewProps = {
  /** Group produced by {@link groupTimelineThoughts}; count must be ≥ 2. */
  unit: ThoughtGroupUnit;
};

/**
 * Summary row for adjacent thoughts; expands to per-segment bodies.
 * @param props Group unit with items and totalMs; missing durations degrade the label.
 * @returns A lighter done-state toggle plus optional expanded segment list.
 */
export function ThoughtGroupView(props: ThoughtGroupViewProps) {
  const { unit } = props;
  const [isOpen, setIsOpen] = useState(false);
  const label = formatThoughtGroupLabel(unit.totalMs, unit.count);
  const toggleClassName = cs("thought-toggle", "thought-toggle-done");

  return (
    <div className="item-thought" data-kind="thought-group">
      <button
        type="button"
        className={toggleClassName}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="thought-chevron" aria-hidden="true">
          {isOpen ? "⌄" : "›"}
        </span>
        {label}
      </button>
      {isOpen ? (
        <div className="thought-group-segments">
          {unit.items.map((item, index) => (
            <ThoughtSegmentBody key={item.id} item={item} index={index} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One expanded segment inside a thought group.
 * @param props item Segment text; index is 0-based for a short step label.
 */
function ThoughtSegmentBody(props: { item: ThoughtItem; index: number }) {
  const { item, index } = props;
  if (!item.text) {
    return null;
  }
  return (
    <div className="thought-content" data-thought-step={index + 1}>
      {item.text}
    </div>
  );
}
