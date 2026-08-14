/**
 * Reducers for grok-build orchestration events (`_x.ai/session/update`).
 *
 * These are sidebar data, not conversation: they must never append a timeline
 * row and never finalize an open thought — doing either would slice continuous
 * reasoning into fragments every time a subagent spawns.
 * Pure — no I/O.
 */

import type {
  BackgroundTaskCard,
  GoalSnapshot,
  SessionState,
  SessionUpdate,
  SubagentCard,
} from "./types.js";

/**
 * Discriminants this module owns. `timelineApply` delegates on match, so every
 * kind listed here MUST be removed from the soft-ignore regex — leaving both in
 * place makes the fallback silently shadow future edits to these cases.
 */
const ORCHESTRATION_KINDS = new Set([
  "goal_updated",
  "subagent_spawned",
  "subagent_finished",
  "task_backgrounded",
  "task_completed",
]);

/**
 * Whether applyOrchestrationUpdate handles this update kind.
 * @param kind sessionUpdate discriminant from the raw event.
 * @returns True when the caller must delegate instead of running its own switch.
 */
export function isOrchestrationUpdate(kind: string): boolean {
  return ORCHESTRATION_KINDS.has(kind);
}

/**
 * Read a trimmed string field from a raw agent payload.
 * Upstream is snake_case and may send null; anything non-string yields
 * undefined so callers can fall back instead of storing "null" as text.
 * @param update Raw session update.
 * @param key Payload key to read.
 * @returns Trimmed value, or undefined when absent / empty / wrong type.
 */
function readString(update: SessionUpdate, key: string): string | undefined {
  const value = (update as Record<string, unknown>)[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Read the first non-empty string among alias keys (snake_case then camelCase).
 * grok-build historically emits snake_case; a camelCase payload must still
 * create a card — otherwise the Agents rail stays empty while spawn tools show.
 * @param update Raw session update.
 * @param keys Field names in preference order.
 * @returns First trimmed hit, or undefined when every alias is missing.
 */
function readStringAlias(
  update: SessionUpdate,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(update, key);
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Read a finite number field from a raw agent payload.
 * Missing counters must stay undefined rather than collapse to 0 — a card
 * showing "0 tokens" for an unreported field is a lie the UI cannot detect.
 * @param update Raw session update.
 * @param key Payload key to read.
 * @returns Finite number, or undefined.
 */
function readNumber(update: SessionUpdate, key: string): number | undefined {
  const value = (update as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Merge a subagent patch onto the existing card, mirroring `patchToolCard`.
 * Undefined patch fields never wipe known values, so a `subagent_finished`
 * that arrives before its `subagent_spawned` (or after a reconnect replay)
 * still produces a usable card instead of erasing identity fields.
 * @param existing Prior card for this subagentId, if any.
 * @param patch Partial fields; subagentId is required and always wins.
 * @returns New card object; never mutates `existing`.
 */
function patchSubagentCard(
  existing: SubagentCard | undefined,
  patch: Partial<SubagentCard> & { subagentId: string },
): SubagentCard {
  const base: SubagentCard = existing ?? {
    subagentId: patch.subagentId,
    childSessionId: patch.childSessionId ?? patch.subagentId,
    type: "",
    description: "",
    status: "running",
  };
  const next: SubagentCard = { ...base, subagentId: patch.subagentId };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  return next;
}

/**
 * Merge a background-task patch without wiping known fields with undefined.
 * @param existing Prior card for this taskId, if any.
 * @param patch Partial fields; taskId is required and always wins.
 * @returns New card; never mutates `existing`.
 */
function patchBackgroundTaskCard(
  existing: BackgroundTaskCard | undefined,
  patch: Partial<BackgroundTaskCard> & { taskId: string },
): BackgroundTaskCard {
  const base: BackgroundTaskCard = existing ?? {
    taskId: patch.taskId,
    command: patch.command ?? "",
    status: patch.status ?? "running",
  };
  const next: BackgroundTaskCard = { ...base, taskId: patch.taskId };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      Object.assign(next, { [key]: value });
    }
  }
  return next;
}

/**
 * Apply task_backgrounded / task_completed to the background task map.
 * `task_completed` carries a full `task_snapshot` rather than a flat patch, so
 * the two kinds read from different shapes and must not share a flat code path.
 * @param state Current snapshot.
 * @param update Raw task event.
 * @param kind Discriminant already extracted by the caller.
 * @returns New state; unchanged when the payload has no task id.
 */
function applyBackgroundTaskUpdate(
  state: SessionState,
  update: SessionUpdate,
  kind: string,
): SessionState {
  const snapshot =
    kind === "task_completed"
      ? ((update as { task_snapshot?: Record<string, unknown> }).task_snapshot ??
        {})
      : (update as unknown as Record<string, unknown>);
  const taskIdRaw = snapshot.task_id;
  const taskId = typeof taskIdRaw === "string" ? taskIdRaw.trim() : "";
  if (!taskId) {
    return state;
  }
  const readSnapString = (key: string): string | undefined => {
    const value = snapshot[key];
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  };
  const status =
    kind === "task_completed"
      ? (readSnapString("status") ?? "completed")
      : (readSnapString("status") ?? "running");
  const card = patchBackgroundTaskCard(state.backgroundTasks?.[taskId], {
    taskId,
    toolCallId: readSnapString("tool_call_id"),
    command: readSnapString("command"),
    cwd: readSnapString("cwd"),
    outputFile: readSnapString("output_file"),
    description: readSnapString("description"),
    status,
  });
  return {
    ...state,
    backgroundTasks: { ...(state.backgroundTasks ?? {}), [taskId]: card },
  };
}

/**
 * Apply one orchestration event to session state.
 * Caller must gate on `isOrchestrationUpdate` first.
 * @param state Current snapshot; not mutated in place.
 * @param update Raw orchestration update (snake_case payload).
 * @returns New state with `goal` / `subagents` / `backgroundTasks` updated;
 *   `timeline` is returned untouched by contract. Goal wrap-up text lives on
 *   `goal.lastEventDetail`, never as a synthesized timeline row.
 */
export function applyOrchestrationUpdate(
  state: SessionState,
  update: SessionUpdate,
): SessionState {
  const kind = String(update.sessionUpdate);

  if (kind === "goal_updated") {
    const goalId = readString(update, "goal_id");
    if (!goalId) {
      return state;
    }
    /** Fresh worker/orchestrator prose; undefined when this frame omitted it. */
    const incomingDetail = readString(update, "last_event_detail");
    /** Previous goal on this session; used only to keep an omitted wrap-up. */
    const prior = state.goal;
    /** Same goal id → keep prior lastEventDetail; a new id must not inherit it. */
    const sameGoal = prior?.goalId === goalId;
    const goal: GoalSnapshot = {
      goalId,
      objective: readString(update, "objective") ?? "",
      status: readString(update, "status") ?? "active",
      phase: readString(update, "phase") ?? "",
      totalDeliverables: readNumber(update, "total_deliverables") ?? 0,
      completedDeliverables: readNumber(update, "completed_deliverables") ?? 0,
      workerRounds: readNumber(update, "total_worker_rounds") ?? 0,
      verifyRounds: readNumber(update, "total_verify_rounds") ?? 0,
      tokensUsed: readNumber(update, "tokens_used") ?? 0,
      lastEvent: readString(update, "last_event"),
      lastEventAt: readString(update, "last_event_timestamp"),
      // Classifier / pause frames omit the worker summary; keep the last one.
      lastEventDetail:
        incomingDetail ?? (sameGoal ? prior?.lastEventDetail : undefined),
    };
    return { ...state, goal };
  }

  if (kind === "subagent_spawned" || kind === "subagent_finished") {
    const subagentId = readStringAlias(update, "subagent_id", "subagentId");
    if (!subagentId) {
      return state;
    }
    const spawned = kind === "subagent_spawned";
    const existing = state.subagents?.[subagentId];
    // Monotonic: a reordered/replayed spawn must not reopen a finished card.
    const existingTerminal =
      existing?.status === "completed" || existing?.status === "failed";
    if (spawned && existingTerminal) {
      return state;
    }
    // Order-independent join: link may already exist from a completed spawn card.
    // Elapsed clocks stay client-local (desktop); never write startedAtMs here
    // so session/load replay does not invent a "just started" clock.
    const linkedToolCallId = state.subagentLinks?.[subagentId];
    const card = patchSubagentCard(existing, {
      subagentId,
      childSessionId: readStringAlias(
        update,
        "child_session_id",
        "childSessionId",
      ),
      parentPromptId: readStringAlias(
        update,
        "parent_prompt_id",
        "parentPromptId",
      ),
      type: readStringAlias(update, "subagent_type", "subagentType"),
      description: readString(update, "description"),
      model: readString(update, "model"),
      // spawned carries no status field; finished reports completed / failed.
      status: spawned ? "running" : (readString(update, "status") ?? "completed"),
      toolCalls: readNumber(update, "tool_calls"),
      turns: readNumber(update, "turns"),
      durationMs: readNumber(update, "duration_ms"),
      tokensUsed: readNumber(update, "tokens_used"),
      output: readString(update, "output"),
      // Prefer existing card link if already set; else take map entry.
      toolCallId: existing?.toolCallId ?? linkedToolCallId,
    });
    return {
      ...state,
      subagents: { ...(state.subagents ?? {}), [subagentId]: card },
    };
  }

  // task_backgrounded / task_completed
  return applyBackgroundTaskUpdate(state, update, kind);
}
