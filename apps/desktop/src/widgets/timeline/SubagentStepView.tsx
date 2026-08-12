/**
 * One subagent row inside an L1 fan-out group (Stateless presentation).
 * Shows status, description, honest duration, and optional expandable output.
 * Click opens the child session when catalog membership is known; otherwise
 * the row is non-clickable with a sync tooltip (not a silent no-op).
 */

import cs from "classnames";
import { useState } from "react";
import type { SubagentCard, ToolCallCard } from "@grok-desktop/acp-core";
import {
  formatLiveElapsed,
  formatSubagentDuration,
  normalizeSubagentStatus,
  subagentMetricParts,
} from "@/lib/agentCards";
import { StreamingMarkdownView } from "./StreamingMarkdownView";

export type SubagentStepViewProps = {
  /** Orchestration card when linked; undefined while spawn has not joined. */
  card: SubagentCard | undefined;
  /** Spawn tool card for title fallback before orchestration arrives. */
  toolCard: ToolCallCard | undefined;
  /**
   * True when `childSessionId` is present in the session catalog so drill-down
   * can resolve. False/undefined → row is not a button.
   */
  canOpen: boolean;
  /**
   * Local wall-clock ms when this running card was first observed.
   * Used only while status is running and durationMs is absent.
   */
  startedAtMs?: number;
  /** Tick for live elapsed re-render (parent owns the interval). */
  nowMs?: number;
  /**
   * Open the child session for readonly drill-down.
   * Only called when canOpen is true.
   */
  onOpen?: (childSessionId: string) => void;
};

/**
 * Single fan-out row: status dot + description + metrics + optional output.
 * @param props Card/tool fallback, openability, live clock, open handler.
 * @returns listitem row; non-clickable when catalog has not synced the child.
 */
export function SubagentStepView(props: SubagentStepViewProps) {
  const { card, toolCard, canOpen, startedAtMs, nowMs, onOpen } = props;
  const [outputOpen, setOutputOpen] = useState(false);
  const status = normalizeSubagentStatus(card?.status ?? toolCard?.status);
  const description =
    card?.description ||
    (typeof toolCard?.rawInput?.description === "string"
      ? toolCard.rawInput.description
      : undefined) ||
    toolCard?.title ||
    card?.subagentId ||
    toolCard?.toolCallId ||
    "Subagent";
  const duration =
    status === "running"
      ? formatLiveElapsed(startedAtMs, nowMs)
      : formatSubagentDuration(card?.durationMs);
  const metrics = card ? subagentMetricParts(card) : [];
  const childId = card?.childSessionId;
  const openable = Boolean(canOpen && childId && onOpen);
  const meta = [status, duration, ...metrics].filter(Boolean).join(" · ");
  let statusClass = "tool-status-pending";
  if (status === "completed") {
    statusClass = "tool-status-completed";
  } else if (status === "failed") {
    statusClass = "tool-status-failed";
  } else if (status === "running") {
    statusClass = "tool-status-in_progress";
  }

  const body = (
    <>
      <span className={cs("tool-status-dot", statusClass)} aria-hidden="true" />
      <span className="subagent-step-label">{description}</span>
      {meta ? <span className="subagent-step-meta">{meta}</span> : null}
    </>
  );

  return (
    <div
      className={cs("subagent-step", {
        "subagent-step-openable": openable,
      })}
      role="listitem"
    >
      {openable && childId ? (
        <button
          type="button"
          className="subagent-step-main btn-ghost"
          onClick={() => onOpen?.(childId)}
          title={`Open subagent · ${description}`}
        >
          {body}
        </button>
      ) : (
        <div
          className="subagent-step-main"
          title={
            childId
              ? "Not synced yet — refresh the session list to open"
              : undefined
          }
        >
          {body}
        </div>
      )}
      {card?.output ? (
        <button
          type="button"
          className="subagent-step-output-toggle btn-ghost"
          aria-expanded={outputOpen}
          onClick={() => setOutputOpen((o) => !o)}
        >
          {outputOpen ? "Hide output" : "Show output"}
        </button>
      ) : null}
      {outputOpen && card?.output ? (
        <div className="subagent-step-output">
          <StreamingMarkdownView text={card.output} />
        </div>
      ) : null}
    </div>
  );
}
