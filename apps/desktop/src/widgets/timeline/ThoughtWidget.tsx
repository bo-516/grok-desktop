/**
 * Soft collapsible Thinking pill (Framer: muted inline control, not a heavy card).
 * Expanded state belongs only to this render instance; the protocol timeline only
 * stores the initial collapsed flag and streaming lifecycle fields.
 * Completed rows auto-collapse unless the user already toggled expand this mount.
 */

import cs from "classnames";
import { useEffect, useRef, useState } from "react";
import type { SessionStatus, TimelineItem } from "@grok-desktop/acp-core";
import {
  formatThoughtLabel,
  shouldAutoCollapseThought,
} from "@/lib/thoughtLabel";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

type ThoughtWidgetProps = {
  item: ThoughtItem;
  sessionStatus: SessionStatus;
};

/**
 * Renders an expandable agent-reasoning segment without mixing reasoning into the final answer body.
 * @param props Thought fragment and session status; missing timestamps safely degrade to a generic Thought label.
 * @returns A Thinking row the user can expand or collapse.
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
  const toggleClassName = cs("thought-toggle", {
    "thought-toggle-done": isDone,
  });

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
    <div className={className} data-kind="thought">
      <button
        type="button"
        className={toggleClassName}
        aria-expanded={isOpen}
        onClick={() => {
          userToggledRef.current = true;
          setIsOpen((open) => !open);
        }}
      >
        <span className="thought-chevron" aria-hidden="true">
          {isOpen ? "⌄" : "›"}
        </span>
        {label}
      </button>
      {isOpen && item.text ? (
        <div className="thought-content">{item.text}</div>
      ) : null}
    </div>
  );
}
