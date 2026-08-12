/**
 * Orchestration reducers via the real applySessionUpdate export.
 * Fixtures mirror design doc §2.3 payloads.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
  isOrchestrationUpdate,
  resetTimelineIdCounter,
} from "../src/timeline.js";

/** §2.3-shaped subagent_spawned payload. */
const SPAWNED = {
  sessionUpdate: "subagent_spawned",
  subagent_id: "019feb2e-97ef-0000-0000-000000000001",
  parent_session_id: "019feb2e-5fe5-0000-0000-000000000001",
  parent_prompt_id: "acc24062-0000-0000-0000-000000000001",
  child_session_id: "019feb2e-97ef-0000-0000-000000000001",
  subagent_type: "general-purpose",
  description: "goal plan writer",
  effective_context_source: "new",
  model: "grok-4.5",
} as const;

/** §2.3-shaped subagent_finished payload. */
const FINISHED = {
  sessionUpdate: "subagent_finished",
  subagent_id: "019feb2e-97ef-0000-0000-000000000001",
  child_session_id: "019feb2e-97ef-0000-0000-000000000001",
  status: "completed",
  tool_calls: 8,
  turns: 1,
  duration_ms: 69265,
  tokens_used: 29295,
  output: "Done",
  will_wake: false,
} as const;

/** §2.3-shaped goal_updated payload. */
const GOAL = {
  sessionUpdate: "goal_updated",
  goal_id: "295823fd-0000-0000-0000-000000000001",
  objective: "@CODE_REVIEW.md 解决这些review发现的问题吧",
  status: "active",
  phase: "executing",
  tokens_used: 0,
  elapsed_ms: 0,
  total_deliverables: 0,
  completed_deliverables: 0,
  total_worker_rounds: 0,
  total_verify_rounds: 0,
  token_baseline: 7075,
  finished_subagent_tokens: 0,
  last_event: "goal_created",
  last_event_timestamp: "2026-08-10T10:18:47.000Z",
} as const;

/** §2.3-shaped task_backgrounded payload. */
const TASK_BG = {
  sessionUpdate: "task_backgrounded",
  tool_call_id: "call-737e0f3a-0000-0000-0000-000000000001",
  task_id: "019fdb1a-0000-0000-0000-000000000001",
  command: "/usr/bin/bsim",
  cwd: "/Users/me/simple",
  output_file: "/tmp/terminal/call-737e0f3a.log",
  description: "Start bsim HTTP server",
} as const;

describe("timeline orchestration", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("isOrchestrationUpdate covers the five kinds only", () => {
    for (const kind of [
      "goal_updated",
      "subagent_spawned",
      "subagent_finished",
      "task_backgrounded",
      "task_completed",
    ]) {
      assert.equal(isOrchestrationUpdate(kind), true, kind);
    }
    assert.equal(isOrchestrationUpdate("agent_message_chunk"), false);
    assert.equal(isOrchestrationUpdate("turn_completed"), false);
  });

  it("subagent_spawned creates a running card with identity fields", () => {
    let state = createSessionState({ id: "parent" });
    const beforeLen = state.timeline.length;
    state = applySessionUpdate(state, { ...SPAWNED });
    const card = state.subagents?.[SPAWNED.subagent_id];
    assert.ok(card);
    assert.equal(card?.status, "running");
    assert.equal(card?.childSessionId, SPAWNED.child_session_id);
    assert.equal(card?.description, SPAWNED.description);
    assert.equal(card?.type, SPAWNED.subagent_type);
    assert.equal(card?.model, SPAWNED.model);
    assert.equal(card?.parentPromptId, SPAWNED.parent_prompt_id);
    assert.equal(state.timeline.length, beforeLen);
  });

  it("subagent_finished patches the same id in place without wiping identity", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, { ...SPAWNED });
    state = applySessionUpdate(state, { ...FINISHED });
    const ids = Object.keys(state.subagents ?? {});
    assert.equal(ids.length, 1);
    const card = state.subagents?.[SPAWNED.subagent_id];
    assert.equal(card?.status, "completed");
    assert.equal(card?.tokensUsed, 29295);
    assert.equal(card?.durationMs, 69265);
    assert.equal(card?.toolCalls, 8);
    assert.equal(card?.turns, 1);
    assert.equal(card?.description, "goal plan writer");
    assert.equal(card?.type, "general-purpose");
    assert.equal(card?.output, "Done");
  });

  it("finished-before-spawned still yields a usable card", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, { ...FINISHED });
    const card = state.subagents?.[FINISHED.subagent_id];
    assert.ok(card);
    assert.equal(card?.status, "completed");
    assert.equal(card?.childSessionId, FINISHED.child_session_id);
    assert.equal(card?.tokensUsed, 29295);
  });

  it("missing subagent_id / goal_id returns prior state without throw", () => {
    const state = createSessionState({ id: "parent" });
    const afterSub = applySessionUpdate(state, {
      sessionUpdate: "subagent_spawned",
      description: "no id",
    });
    assert.equal(afterSub, state);
    const afterGoal = applySessionUpdate(state, {
      sessionUpdate: "goal_updated",
      objective: "no id",
    });
    assert.equal(afterGoal, state);
  });

  it("unreported counters stay undefined not 0", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, {
      sessionUpdate: "subagent_spawned",
      subagent_id: "only-id",
      child_session_id: "only-id",
      subagent_type: "explore",
      description: "scan",
    });
    const card = state.subagents?.["only-id"];
    assert.equal(card?.turns, undefined);
    assert.equal(card?.tokensUsed, undefined);
    assert.equal(card?.durationMs, undefined);
    assert.equal(card?.toolCalls, undefined);
  });

  it("goal_updated overwrites with latest phase and objective", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, { ...GOAL });
    assert.equal(state.goal?.phase, "executing");
    assert.equal(state.goal?.objective, GOAL.objective);
    assert.equal(state.goal?.goalId, GOAL.goal_id);
    assert.equal(state.goal?.lastEvent, "goal_created");
    state = applySessionUpdate(state, {
      ...GOAL,
      phase: "idle",
      status: "complete",
      last_event: "goal_complete",
    });
    assert.equal(state.goal?.phase, "idle");
    assert.equal(state.goal?.status, "complete");
    assert.equal(state.goal?.lastEvent, "goal_complete");
  });

  it("task_backgrounded then task_completed merges same taskId from task_snapshot", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, { ...TASK_BG });
    const bg = state.backgroundTasks?.[TASK_BG.task_id];
    assert.ok(bg);
    assert.equal(bg?.status, "running");
    assert.equal(bg?.command, TASK_BG.command);
    assert.equal(bg?.description, TASK_BG.description);
    assert.equal(bg?.outputFile, TASK_BG.output_file);
    state = applySessionUpdate(state, {
      sessionUpdate: "task_completed",
      task_snapshot: {
        task_id: TASK_BG.task_id,
        tool_call_id: TASK_BG.tool_call_id,
        command: TASK_BG.command,
        cwd: TASK_BG.cwd,
        output_file: TASK_BG.output_file,
        description: TASK_BG.description,
        status: "completed",
      },
    });
    const done = state.backgroundTasks?.[TASK_BG.task_id];
    assert.equal(Object.keys(state.backgroundTasks ?? {}).length, 1);
    assert.equal(done?.status, "completed");
    assert.equal(done?.command, TASK_BG.command);
  });

  it("orchestration events never change timeline length", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "hello" },
    });
    const len = state.timeline.length;
    for (const update of [
      { ...SPAWNED },
      { ...FINISHED },
      { ...GOAL },
      { ...TASK_BG },
    ]) {
      state = applySessionUpdate(state, update);
      assert.equal(state.timeline.length, len, String(update.sessionUpdate));
    }
  });

  it("thought-chunk → orchestration → thought-chunk stays a single thought row", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking A " },
    });
    state = applySessionUpdate(state, { ...SPAWNED });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking B" },
    });
    const thoughts = state.timeline.filter((t) => t.kind === "thought");
    assert.equal(thoughts.length, 1);
    const text =
      thoughts[0] && thoughts[0].kind === "thought" ? thoughts[0].text : "";
    assert.match(text, /thinking A /);
    assert.match(text, /thinking B/);
  });

  it("does not mutate the prior state object in place", () => {
    const state = createSessionState({ id: "parent" });
    const frozenTimeline = state.timeline;
    const next = applySessionUpdate(state, { ...SPAWNED });
    assert.notEqual(next, state);
    assert.equal(state.subagents, undefined);
    assert.equal(state.timeline, frozenTimeline);
  });

  it("links spawn card completion then subagent_spawned (card-first order)", () => {
    let state = createSessionState({ id: "parent" });
    const toolCallId = "call-spawn-1";
    const spawnBody = `Subagent started in background.
subagent_id: ${SPAWNED.subagent_id}
type: general-purpose
description: goal plan writer`;
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "spawn_subagent",
      kind: "other",
      status: "pending",
      _meta: {
        "x.ai/tool": { name: "spawn_subagent", kind: "task" },
      },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: spawnBody } }],
    });
    assert.equal(state.subagentLinks?.[SPAWNED.subagent_id], toolCallId);
    const lenAfterLink = state.timeline.length;
    state = applySessionUpdate(state, { ...SPAWNED });
    assert.equal(state.timeline.length, lenAfterLink);
    assert.equal(state.subagents?.[SPAWNED.subagent_id]?.toolCallId, toolCallId);
  });

  it("links subagent_spawned then spawn card completion (event-first order)", () => {
    let state = createSessionState({ id: "parent" });
    const toolCallId = "call-spawn-2";
    const spawnBody = `Subagent started in background.
subagent_id: ${SPAWNED.subagent_id}
type: general-purpose
description: goal plan writer`;
    state = applySessionUpdate(state, { ...SPAWNED });
    assert.equal(state.subagents?.[SPAWNED.subagent_id]?.toolCallId, undefined);
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "Create Vue+Vite project",
      kind: "other",
      status: "completed",
      content: spawnBody,
      _meta: {
        "x.ai/tool": { name: "spawn_subagent", kind: "task" },
      },
    });
    assert.equal(state.subagentLinks?.[SPAWNED.subagent_id], toolCallId);
    assert.equal(state.subagents?.[SPAWNED.subagent_id]?.toolCallId, toolCallId);
  });

  it("subagentLinks first write wins (no overwrite)", () => {
    let state = createSessionState({ id: "parent" });
    const first = "call-first";
    const second = "call-second";
    const body = `subagent_id: ${SPAWNED.subagent_id}`;
    const meta = { "x.ai/tool": { name: "spawn_subagent" } };
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: first,
      status: "completed",
      content: body,
      _meta: meta,
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: second,
      status: "completed",
      content: body,
      _meta: meta,
    });
    assert.equal(state.subagentLinks?.[SPAWNED.subagent_id], first);
  });
});

describe("knownSilent + unknown kinds via applySessionUpdate", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("silences known non-orchestration vendor kinds without error rows", () => {
    const kinds = [
      "turn_completed",
      "session_recap",
      "retry_state",
      "image_compressed",
      "image_dropped",
    ];
    for (const kind of kinds) {
      const state = createSessionState({ id: "s1" });
      const next = applySessionUpdate(state, { sessionUpdate: kind });
      assert.equal(next.timeline.length, 0, kind);
      assert.equal(
        next.timeline.some((t) => t.kind === "error"),
        false,
        kind,
      );
    }
  });

  it("still emits one error row for a genuinely unknown kind", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "totally_new_kind",
    });
    const errors = state.timeline.filter((t) => t.kind === "error");
    assert.equal(errors.length, 1);
    assert.match(
      errors[0] && errors[0].kind === "error" ? errors[0].message : "",
      /Unknown sessionUpdate: totally_new_kind/,
    );
  });
});
