/**
 * Codex-style collapsible Thinking row.
 * Expanded state belongs only to this render instance; the protocol timeline only
 * stores the initial collapsed flag and streaming lifecycle fields.
 */

import cs from "classnames";
import { useState } from "react";
import type { SessionStatus, TimelineItem } from "@grok-desktop/acp-core";

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
  const label = formatThoughtLabel(item, sessionStatus);
  const className = cs("item-thought", { "item-thought-open": isOpen });

  return (
    <div className={className} data-kind="thought">
      <button
        type="button"
        className="thought-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="thought-chevron" aria-hidden="true">
          {isOpen ? "⌄" : "›"}
        </span>
        {label}
      </button>
      {isOpen ? <div className="thought-content">{item.text}</div> : null}
    </div>
  );
}

/**
 * Builds a short label from the thought lifecycle.
 * @param item Thought produced by the protocol reducer; missing completedAt means still streaming.
 * @param sessionStatus Current session status for legacy cached entries without timestamps.
 * @returns `Thinking`, `Thought`, or a completed label with seconds.
 */
function formatThoughtLabel(item: ThoughtItem, sessionStatus: SessionStatus): string {
  if (item.completedAt === undefined && sessionStatus === "streaming") {
    return "Thinking";
  }
  if (!item.startedAt || !item.completedAt) {return "Thought";}

  const seconds = Math.max(1, Math.round((item.completedAt - item.startedAt) / 1000));
  return `Thought for ${seconds}s`;
}
