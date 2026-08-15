/**
 * Consecutive Thought segments inside a turn activity rail.
 * Defaults open on mount so expanding a Worked rail reveals segment bodies;
 * user can still collapse. Uses turn-step geometry (shell-toggle only on the
 * Codex-style turn rail header). Expand chrome is {@link CollapsibleStepView}.
 * Expanded groups follow the last segment's growth inside the turn-rail.
 */

import { useRef, useState } from "react";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { formatThoughtGroupLabel } from "@/lib/thoughtLabel";
import type { ThoughtGroupUnit } from "@/lib/thoughtGrouping";
import { CollapsibleStepView } from "@/widgets/shared";
import { useFollowThoughtInRail } from "./useFollowThoughtInRail";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

type ThoughtGroupViewProps = {
  /** Group produced by {@link groupTimelineThoughts}; count must be ≥ 2. */
  unit: ThoughtGroupUnit;
};

/**
 * Summary row for adjacent thoughts; expands to per-segment bodies.
 * While open and the last segment is live, new text keeps the turn-rail on the tail.
 * @param props Group unit with items and totalMs; missing durations degrade the label.
 * @returns A turn-step toggle plus optional expanded segment list.
 */
export function ThoughtGroupView(props: ThoughtGroupViewProps) {
  const { unit } = props;
  /** Open by default when the parent Worked rail mounts this body. */
  const [isOpen, setIsOpen] = useState(true);
  const label = formatThoughtGroupLabel(unit.totalMs, unit.count);
  /** Last segment in the group (the one that may still be streaming). */
  const lastItem = unit.items[unit.items.length - 1];
  /** Last segment text — grows while the group is still streaming. */
  const lastText = lastItem?.text ?? "";
  /** True when the last segment has not finalized (still receiving chunks). */
  const lastLive = lastItem !== undefined && lastItem.completedAt === undefined;
  /** Group body — follow-scroll target for the last segment's tail. */
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useFollowThoughtInRail({
    open: isOpen,
    enabled: lastLive,
    contentKey: `${unit.items.length}:${lastText}`,
    bodyRef,
  });

  return (
    <CollapsibleStepView
      open={isOpen}
      onToggle={() => setIsOpen((open) => !open)}
      label={label}
      body={
        <div ref={bodyRef} className="thought-group-segments">
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
