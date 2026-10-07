/**
 * Orchestration side-state reported by grok-build: goal snapshot, spawned
 * subagents, and backgrounded shell tasks. Sidebar data keyed by id — never
 * timeline rows — so replayed or out-of-order events converge in place.
 */

/**
 * Orchestration goal snapshot from `goal_updated`; absent outside goal mode.
 * Counters default to 0 when a goal exists (agent always reports them).
 */
export type GoalSnapshot = {
  /** Stable goal id from the orchestrator. */
  goalId: string;
  /** User objective verbatim; drives the goal header. */
  objective: string;
  /** active | complete | … — agent-defined, kept as string on purpose. */
  status: string;
  /** executing | idle | … — the orchestrator's current stage. */
  phase: string;
  /** Deliverables the orchestrator planned for this goal. */
  totalDeliverables: number;
  /** Deliverables already marked done. */
  completedDeliverables: number;
  /** Worker rounds run so far. */
  workerRounds: number;
  /** Verification rounds run so far. */
  verifyRounds: number;
  /** Tokens consumed across the goal. */
  tokensUsed: number;
  /** Last state-machine transition name (e.g. `goal_created`). */
  lastEvent?: string;
  /** Timestamp string of `lastEvent` as sent by the agent. */
  lastEventAt?: string;
  /**
   * Prose from `last_event_detail` (worker FINAL_RESPONSE / completion note).
   * Goal mode often never emits a trailing `agent_message_chunk`; this is the
   * only user-facing wrap-up on the wire. Later `goal_updated` frames that
   * omit the field must not wipe a previously captured value.
   */
  lastEventDetail?: string;
};

/**
 * One subagent the orchestrator spawned.
 * A completed `spawn_subagent` tool may create the card first; `subagent_spawned`
 * / `subagent_finished` then patch it in place — same lifecycle as `toolCalls`,
 * so out-of-order or replayed events converge on one row.
 * Unreported counters stay `undefined` (not `0`) so the UI can hide missing data.
 */
export type SubagentCard = {
  subagentId: string;
  /** Drill-down target: a real session id loadable via `session/load`. */
  childSessionId: string;
  /** Parent turn that spawned it; groups fan-out by round. */
  parentPromptId?: string;
  /** general-purpose | explore | plan */
  type: string;
  /** Agent-written role label, e.g. "goal achievement skeptic". */
  description: string;
  model?: string;
  /** running until `subagent_finished` reports completed / failed. */
  status: string;
  toolCalls?: number;
  turns?: number;
  durationMs?: number;
  tokensUsed?: number;
  output?: string;
  /**
   * Spawn tool card that created this subagent; resolved from `subagentLinks`.
   * Order-independent: may arrive via spawn-card completion first or via
   * `subagent_spawned` reading an earlier link write.
   */
  toolCallId?: string;
};

/**
 * One backgrounded shell task from `task_backgrounded` / `task_completed`.
 * Unreported optional fields stay undefined rather than collapsing to empty.
 */
export type BackgroundTaskCard = {
  taskId: string;
  /** Tool call that spawned it; links the card back to its timeline row. */
  toolCallId?: string;
  command: string;
  cwd?: string;
  /**
   * Absolute log path under `<session>/terminal/` (outside the project
   * workspace). Preview must sandbox the read to that directory.
   */
  outputFile?: string;
  description?: string;
  status: string;
};
