/**
 * Detail header (Stateless): status · elapsed · metrics, plus error.
 * Title is omitted — the selected roster row already shows it.
 */

import type { SubagentCard } from "@grok-desktop/acp-core";
import {
  formatLiveElapsed,
  formatSubagentDuration,
  normalizeSubagentStatus,
  subagentMetricParts,
} from "@/lib/agentCards";

export type SubagentDetailHeadViewProps = {
  /** Orchestration card for the focused child; undefined while spawn is joining. */
  card: SubagentCard | undefined;
  /** True when the body came from a catalog snapshot (show Ended). */
  ended: boolean;
  /** Failed-card error banner text; omit when not failed. */
  error?: string;
  /** First-seen running clock for live elapsed. */
  startedAtMs?: number;
  /** Shared ticker instant. */
  nowMs?: number;
};

/**
 * Slim status strip above the child transcript.
 * @param props Card, ended/error flags, live clock. Identity lives on
 *   the selected roster row, so this strip never reprints the title.
 * @returns Meta/error strip, or null when both are empty so the pane
 *   does not keep a blank header bar.
 */
export function SubagentDetailHeadView(props: SubagentDetailHeadViewProps) {
  const { card, ended, error, startedAtMs, nowMs } = props;
  const status = normalizeSubagentStatus(card?.status);
  const duration =
    status === "running"
      ? formatLiveElapsed(startedAtMs, nowMs)
      : formatSubagentDuration(card?.durationMs);
  const metrics = card ? subagentMetricParts(card) : [];
  const endedLabel = ended && status !== "running" ? "Ended" : "";
  const meta = [status, duration, endedLabel, ...metrics]
    .filter(Boolean)
    .join(" · ");

  if (!meta && !error) {
    return null;
  }

  return (
    <div className="agents-detail-head" data-agents-surface="detail-head">
      {meta ? <p className="agents-detail-head-meta">{meta}</p> : null}
      {error ? (
        <p className="agents-detail-head-error" data-agents-error="failed">
          {error}
        </p>
      ) : null}
    </div>
  );
}
