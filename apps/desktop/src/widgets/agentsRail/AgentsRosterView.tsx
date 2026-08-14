/**
 * Agents roster (Stateless): goal, rounds of subagents, background tasks.
 * Rows focus a child in the panel — they never select a session.
 * Compact (inspect) is a title-only picker so the child transcript
 * keeps leftover space; fill (roster-only) grows to consume the pane.
 */

import cs from "classnames";
import type {
  BackgroundTaskCard,
  GoalSnapshot,
} from "@grok-desktop/acp-core";
import {
  backgroundTaskLine,
  type SubagentRound,
} from "@/lib/agentCards";
import { SubagentRosterRowView } from "./SubagentRosterRowView";

export type AgentsRosterViewProps = {
  /** Goal snapshot when the session is in goal mode; omitted otherwise. */
  goal?: GoalSnapshot;
  /** Subagents grouped by parent prompt (fan-out round). */
  rounds: SubagentRound[];
  /** Background shell tasks for this session. */
  backgroundTasks: BackgroundTaskCard[];
  /** Focused / highlighted child session id, or null on roster-only view. */
  focusedChildId: string | null;
  /** Shared ticker for running rows. */
  nowMs: number;
  /** First-seen running clocks keyed by subagent or child id. */
  startedAtById: Record<string, number>;
  /**
   * Focus a child in the companion. Must not navigate the main canvas.
   * @param childSessionId Child ACP session id.
   */
  onFocusChild: (childSessionId: string) => void;
  /**
   * Optional: preview a background task log. The path is the absolute
   * `output_file` under `<session>/terminal/` (outside the project
   * workspace); the hook sandboxes the read to that directory.
   * @param path Absolute output_file from the task card.
   */
  onPreviewLog?: (path: string) => void;
  /**
   * Inspect mode: hide goal + background tasks + section chrome, and
   * render title-only rows under `agents-rail-compact` so a typical
   * fan-out does not grow a mid-panel scrollbar. False / omitted =
   * roster-only fill (`agents-rail-fill`).
   */
  compact?: boolean;
};

/**
 * Agents roster body: optional goal, rounds, background tasks.
 * @param props Round list, focus, clocks, handlers. `compact` switches
 *   fill vs height-capped title-only picker; missing compact is the
 *   roster-only pane.
 * @returns Scrollable sections for the Agents tab.
 */
export function AgentsRosterView(props: AgentsRosterViewProps) {
  const {
    goal,
    rounds,
    backgroundTasks,
    focusedChildId,
    nowMs,
    startedAtById,
    onFocusChild,
    onPreviewLog,
    compact = false,
  } = props;
  const totalCards = rounds.reduce((n, r) => n + r.cards.length, 0);

  return (
    <div
      className={cs("agents-rail", {
        "agents-rail-fill": !compact,
        "agents-rail-compact": compact,
      })}
      data-agents-surface="roster"
      data-agents-roster={compact ? "compact" : "fill"}
    >
      {!compact && goal ? (
        <section className="agents-rail-section agents-rail-goal">
          <h3 className="agents-rail-section-title">Goal</h3>
          <p className="agents-rail-goal-line">
            {goal.phase || goal.status}
            {goal.totalDeliverables > 0
              ? ` · ${goal.completedDeliverables}/${goal.totalDeliverables} deliverables`
              : null}
          </p>
          {goal.objective ? (
            <p className="agents-rail-goal-objective" title={goal.objective}>
              {goal.objective}
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        className={
          compact ? "agents-rail-section-compact" : "agents-rail-section"
        }
      >
        {compact ? null : (
          <h3 className="agents-rail-section-title">Subagents</h3>
        )}
        {totalCards === 0 ? (
          <p className="side-panel-hint" data-agents-empty="subagents">
            No subagents in this session yet.
          </p>
        ) : (
          rounds.map((round, index) => (
            <div key={round.parentPromptId} className="agents-rail-round">
              {compact ? null : (
                <h4 className="agents-rail-round-title">
                  {round.parentPromptId === "ungrouped"
                    ? "Ungrouped"
                    : `Round ${index + 1}`}
                  {` · ${round.cards.length} subagent${round.cards.length === 1 ? "" : "s"}`}
                </h4>
              )}
              <ul className="agents-rail-list">
                {round.cards.map((card) => {
                  const clockKey = card.subagentId || card.childSessionId;
                  return (
                    <li key={card.subagentId}>
                      <SubagentRosterRowView
                        card={card}
                        selected={
                          Boolean(focusedChildId) &&
                          card.childSessionId === focusedChildId
                        }
                        startedAtMs={startedAtById[clockKey]}
                        nowMs={nowMs}
                        onFocus={onFocusChild}
                        compact={compact}
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {!compact ? (
        <section className="agents-rail-section">
          <h3 className="agents-rail-section-title">Background tasks</h3>
          {backgroundTasks.length === 0 ? (
            <p className="side-panel-hint">No background tasks reported.</p>
          ) : (
            <ul className="agents-rail-list">
              {backgroundTasks.map((task) => (
                <li key={task.taskId}>
                  <BackgroundTaskRailRow
                    task={task}
                    onPreviewLog={onPreviewLog}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One background task row; optional log preview when outputFile is set.
 * @param props Task card and optional log preview handler.
 */
function BackgroundTaskRailRow(props: {
  task: BackgroundTaskCard;
  onPreviewLog?: (path: string) => void;
}) {
  const { task, onPreviewLog } = props;
  const line = backgroundTaskLine(task);
  const outputFile = task.outputFile;
  if (outputFile && onPreviewLog) {
    return (
      <button
        type="button"
        className="btn-ghost agents-rail-row"
        onClick={() => onPreviewLog(outputFile)}
        title={`Preview log · ${outputFile}`}
      >
        {line}
      </button>
    );
  }
  return <span className="agents-rail-row">{line}</span>;
}
