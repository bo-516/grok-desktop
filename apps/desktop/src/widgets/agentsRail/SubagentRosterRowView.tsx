/**
 * One Agents roster row (Stateless): role, status, live elapsed, metrics.
 */

import cs from "classnames";
import type { SubagentCard } from "@grok-desktop/acp-core";
import {
  formatLiveElapsed,
  formatSubagentDuration,
  normalizeSubagentStatus,
  subagentMetricParts,
} from "@/lib/agentCards";

export type SubagentRosterRowViewProps = {
  /** Orchestration card for this row. */
  card: SubagentCard;
  /** True when this row is the focused / keyboard-highlighted child. */
  selected: boolean;
  /**
   * Local start clock for a running card; omitted when not yet observed.
   * Combined with `nowMs` for live elapsed.
   */
  startedAtMs?: number;
  /** Shared ticker instant; ignored unless the card is running. */
  nowMs?: number;
  /**
   * Focus this child in the panel. Never navigates the main canvas.
   * @param childSessionId Card child session id.
   */
  onFocus: (childSessionId: string) => void;
  /**
   * Inspect picker: hide the metrics line so each row is one title.
   * False / omitted keeps status · duration · tools under the label.
   */
  compact?: boolean;
};

/**
 * Status-dot class for a normalized subagent status.
 * @param status Normalized status from {@link normalizeSubagentStatus}.
 */
function statusDotClass(status: string): string {
  if (status === "completed") {
    return "tool-status-completed";
  }
  if (status === "failed") {
    return "tool-status-failed";
  }
  if (status === "running") {
    return "tool-status-in_progress";
  }
  return "tool-status-pending";
}

/**
 * Roster row: click focuses the child in the companion (no session select).
 * Status dot and title share one `items-center` line so the indicator stays
 * optically aligned with the label; metrics wrap on the next line under the
 * title instead of fighting it for width. Compact inspect hides metrics so
 * the 300px drawer does not grow a mid-panel scrollbar for a 4-row fan-out.
 * @param props Card, selection, live clock, focus handler, compact flag.
 * @returns One list row button, or a static line when childSessionId is missing.
 */
export function SubagentRosterRowView(props: SubagentRosterRowViewProps) {
  const { card, selected, startedAtMs, nowMs, onFocus, compact = false } = props;
  const status = normalizeSubagentStatus(card.status);
  const duration =
    status === "running"
      ? formatLiveElapsed(startedAtMs, nowMs)
      : formatSubagentDuration(card.durationMs);
  const metrics = subagentMetricParts(card);
  const label = card.description || card.type || card.subagentId;
  const meta = [status, duration, ...metrics].filter(Boolean).join(" · ");
  const childId = card.childSessionId?.trim();

  const body = (
    <>
      <span className="agents-roster-row-title">
        <span
          className={cs("tool-status-dot", statusDotClass(status))}
          aria-hidden="true"
        />
        <span className="agents-roster-row-label">{label}</span>
      </span>
      {!compact && meta ? (
        <span className="agents-roster-row-meta">{meta}</span>
      ) : null}
    </>
  );

  if (!childId) {
    return (
      <span className="agents-roster-row agents-roster-row-disabled">{body}</span>
    );
  }

  return (
    <button
      type="button"
      className={cs("btn-ghost agents-roster-row", {
        "agents-roster-row-selected": selected,
      })}
      aria-current={selected ? "true" : undefined}
      onClick={() => onFocus(childId)}
      title={label}
    >
      {body}
    </button>
  );
}
