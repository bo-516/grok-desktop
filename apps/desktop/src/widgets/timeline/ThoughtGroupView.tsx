/**
 * Consecutive Thought segments inside a turn activity rail.
 * Defaults open on mount so expanding a Worked rail reveals segment bodies;
 * user can still collapse. Uses turn-step geometry (shell-toggle only on the
 * Codex-style turn rail header). Expand chrome is {@link CollapsibleStepView}.
 */

import { useState } from "react";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { formatThoughtGroupLabel } from "@/lib/thoughtLabel";
import type { ThoughtGroupUnit } from "@/lib/thoughtGrouping";
import { CollapsibleStepView } from "@/widgets/shared";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

type ThoughtGroupViewProps = {
  /** Group produced by {@link groupTimelineThoughts}; count must be ≥ 2. */
  unit: ThoughtGroupUnit;
};

/**
 * Summary row for adjacent thoughts; expands to per-segment bodies.
 * @param props Group unit with items and totalMs; missing durations degrade the label.
 * @returns A turn-step toggle plus optional expanded segment list.
 */
export function ThoughtGroupView(props: ThoughtGroupViewProps) {
  const { unit } = props;
  /** Open by default when the parent Worked rail mounts this body. */
  const [isOpen, setIsOpen] = useState(true);
  const label = formatThoughtGroupLabel(unit.totalMs, unit.count);

  return (
    <CollapsibleStepView
      open={isOpen}
      onToggle={() => setIsOpen((open) => !open)}
      label={label}
      body={
        <div className="thought-group-segments">
          {unit.items.map((item, index) => (
            <ThoughtSegmentBody key={item.id} item={item} index={index} />
          ))}
        </div>
      }
      variant="turn-step"
      className="item-thought"
      dataKind="thought-group"
    />
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
    <div className="turn-step-body" data-thought-step={index + 1}>
      {item.text}
    </div>
  );
}
