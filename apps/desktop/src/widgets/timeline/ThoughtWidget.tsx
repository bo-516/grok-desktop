/**
 * Soft collapsible Thinking step inside a turn activity rail.
 * Uses turn-step geometry (not shell-toggle pills) so only the rail header
 * carries filled chrome. Expanded state is local to this mount; completed rows
 * auto-collapse unless the user already toggled expand.
 * Presentation chrome is {@link CollapsibleStepView}; this widget owns policy.
 */

import cs from "classnames";
import { useEffect, useRef, useState } from "react";
import type { SessionStatus, TimelineItem } from "@grok-desktop/acp-core";
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
  /** Local expand switch; refresh or history replay resets to the agent-provided collapsed default. */
  const [isOpen, setIsOpen] = useState(!item.collapsed);
  /** Once true, completedAt landing must not force-collapse (user owns expand state). */
  const userToggledRef = useRef(false);
  /** Previous completedAt so we only auto-collapse on the streaming → done edge. */
  const prevCompletedAtRef = useRef(item.completedAt);
  const label = formatThoughtLabel(item, sessionStatus);
  const isDone = item.completedAt !== undefined;
  const className = cs("item-thought", { "item-thought-open": isOpen });

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
      label={label}
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
