/**
 * Session-scoped Agents rail body (Stateless).
 * Lists subagents grouped by parentPromptId and background tasks.
 * No fake /tasks slash kill/refresh — stop a turn via cancelTurn elsewhere.
 */

import type {
  BackgroundTaskCard,
  GoalSnapshot,
  SubagentCard,
} from "@grok-desktop/acp-core";
import {
  backgroundTaskLine,
  type SubagentRound,
  subagentCardLine,
} from "@/lib/agentCards";

export type AgentsRailViewProps = {
  /** Goal snapshot when the session is in goal mode; omitted otherwise. */
  goal?: GoalSnapshot;
  /** Subagents grouped by parent prompt (fan-out round). */
  rounds: SubagentRound[];
  /** Background shell tasks for this session. */
  backgroundTasks: BackgroundTaskCard[];
  /**
   * Catalog ids currently known — used so missing children are non-clickable
   * instead of silent no-ops.
   */
  catalogIds: Set<string>;
  /**
   * Open a child session for readonly drill-down.
   * @param childSessionId Catalog id of the harness-spawned child.
   */
  onOpenChild: (childSessionId: string) => void;
  /**
   * Optional: preview a background task log path when the bridge allows it.
   * @param path Absolute output_file under sessions terminal.
   */
  onPreviewLog?: (path: string) => void;
};

/**
 * Agents rail body: optional goal header, rounds of subagents, background tasks.
 * @param props Round list, tasks, catalog membership, open/preview handlers.
 * @returns Scrollable sections for the context drawer Agents tab.
 */
export function AgentsRailView(props: AgentsRailViewProps) {
  const {
    goal,
    rounds,
    backgroundTasks,
    catalogIds,
    onOpenChild,
    onPreviewLog,
  } = props;
  const totalCards = rounds.reduce((n, r) => n + r.cards.length, 0);

  return (
    <div className="agents-rail">
      {goal ? (
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

      <section className="agents-rail-section">
        <h3 className="agents-rail-section-title">Subagents</h3>
        {totalCards === 0 ? (
          <p className="side-panel-hint">No subagents in this session yet.</p>
        ) : (
          rounds.map((round, index) => (
            <div key={round.parentPromptId} className="agents-rail-round">
              <h4 className="agents-rail-round-title">
                {round.parentPromptId === "ungrouped"
                  ? "Ungrouped"
                  : `Round ${index + 1}`}
                {` · ${round.cards.length} subagent${round.cards.length === 1 ? "" : "s"}`}
              </h4>
              <ul className="agents-rail-list">
                {round.cards.map((card) => (
                  <li key={card.subagentId}>
                    <SubagentRailRow
                      card={card}
                      canOpen={catalogIds.has(card.childSessionId)}
                      onOpen={onOpenChild}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

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
    </div>
  );
}

/**
 * One subagent row in the Agents list.
 * @param props Card, openability, open handler.
 */
function SubagentRailRow(props: {
  card: SubagentCard;
  canOpen: boolean;
  onOpen: (id: string) => void;
}) {
  const { card, canOpen, onOpen } = props;
  const line = subagentCardLine(card);
  if (canOpen) {
    return (
      <button
        type="button"
        className="btn-ghost agents-rail-row"
        onClick={() => onOpen(card.childSessionId)}
        title={`Open ${card.childSessionId}`}
      >
        {line}
      </button>
    );
  }
  return (
    <span
      className="agents-rail-row agents-rail-row-disabled"
      title="Not synced yet — refresh the session list to open"
    >
      {line}
    </span>
  );
}

/**
 * One background task row; optional log preview when outputFile is set.
 * No Kill/Refresh slash commands — those invent non-existent agent verbs.
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
