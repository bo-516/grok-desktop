/**
 * Soft collapsible Thinking step inside a turn activity rail.
 * While the row is live its label is a single shimmering word (Codex-style);
 * once it completes the label is plain `Thought for Ns` text.
 * Uses turn-step geometry (chevron-left rows) so only the rail header uses the
 * Codex-style shell-toggle. Defaults open on mount (parent Worked body only
 * mounts when the rail is expanded or live); completed rows auto-collapse
 * unless the user already toggled expand. Chrome is {@link CollapsibleStepView}.
 */

import cs from "classnames";
import { useEffect, useRef, useState } from "react";
import type { SessionStatus, TimelineItem } from "@grok-desktop/acp-core";
import { ShinyText } from "@/components/react-bits";
import {
  formatThoughtLabel,
  shouldAutoCollapseThought,
} from "@/lib/thoughtLabel";
import { CollapsibleStepView } from "@/widgets/shared";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

type ThoughtWidgetProps = {
  item: ThoughtItem;
  sessionStatus: SessionStatus;
};

/**
 * Renders an expandable agent-reasoning segment without mixing reasoning into the final answer body.
 * @param props Thought fragment and session status; missing timestamps safely degrade to a generic Thought label.
 * @returns A Thinking step row the user can expand or collapse.
 */
export function ThoughtWidget(props: ThoughtWidgetProps) {
  const { item, sessionStatus } = props;
  /**
   * Local expand switch. Defaults open so expanding a Worked rail reveals
   * every Thought body; remount (session reopen / re-expand) resets policy.
   */
  const [isOpen, setIsOpen] = useState(true);
  /** Once true, completedAt landing must not force-collapse (user owns expand state). */
  const userToggledRef = useRef(false);
  /** Previous completedAt so we only auto-collapse on the streaming → done edge. */
  const prevCompletedAtRef = useRef(item.completedAt);
  const label = formatThoughtLabel(item, sessionStatus);
  const isDone = item.completedAt !== undefined;
  const isLive = !isDone && sessionStatus === "streaming";
  const className = cs("item-thought", { "item-thought-open": isOpen });
  /**
   * Live rows read as a single shimmering word (Codex-style); finished rows are
   * plain text so a long transcript is not a wall of moving labels.
   */
  const labelNode = isLive ? (
    // Same sweep rate as the composer strip verb so the two live surfaces read
    // as one motion language rather than two unrelated animations.
    <ShinyText className="thought-live-label" text={label} speed="fast" />
  ) : (
    label
  );

  useEffect(() => {
    const prevCompletedAt = prevCompletedAtRef.current;
    prevCompletedAtRef.current = item.completedAt;
    if (
      shouldAutoCollapseThought({
        prevCompletedAt,
        completedAt: item.completedAt,
        userToggled: userToggledRef.current,
      })
    ) {
      setIsOpen(false);
    }
  }, [item.completedAt]);

  return (
    <CollapsibleStepView
      open={isOpen}
      onToggle={() => {
        userToggledRef.current = true;
        setIsOpen((open) => !open);
      }}
      label={labelNode}
      body={
        item.text ? <div className="turn-step-body">{item.text}</div> : null
      }
      variant="turn-step"
      active={!isDone}
      className={className}
      dataKind="thought"
    />
  );
}
