/**
 * Regression: multi-spawn + Go empty state frames must leave orchestration intact.
 * Drives the shipped createLiveBridgeDispatch path (not a pure reducer re-impl).
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  createSessionState,
  resetTimelineIdCounter,
  type SessionState,
} from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "@/bridge/liveBridgeDispatch";

const PARENT = "parent-fanout-survival";
const IDS = [
  "019feff5-surv-0001-0000-000000000001",
  "019feff5-surv-0001-0000-000000000002",
  "019feff5-surv-0001-0000-000000000003",
  "019feff5-surv-0001-0000-000000000004",
] as const;

/**
 * Go-shaped full-state frame: lifecycle only, empty timeline, no orchestration.
 * @param id Session id.
 * @param status Bridge status for this emit.
 */
function goEmptyState(
  id: string,
  status: SessionState["status"] = "streaming",
): SessionState {
  const s = createSessionState({ id, workspace: "/proj" });
  s.status = status;
  s.model = "grok-4.5";
  s.timeline = [];
  s.toolCalls = {};
  s.lastAgentText = "";
  return s;
}

describe("subagent state survival through live dispatch", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("4× subagent_spawned + Go empty state after each update keeps 4 cards", () => {
    let last: SessionState = createSessionState({
      id: PARENT,
      workspace: "/proj",
    });
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: (s) => {
          last = s;
        },
        onSessionUpdate: (s) => {
          last = s;
        },
      },
    });

    // Seed parent bucket.
    dispatch.handleServerMsg({
      type: "state",
      session: createSessionState({ id: PARENT, workspace: "/proj" }),
    });

    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: PARENT,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "fan out demos" },
      },
      eventId: "ev-user",
    });
    // Go emitState after every update.
    dispatch.handleServerMsg({
      type: "state",
      session: goEmptyState(PARENT),
    });

    // Goal / background / todos so we can assert they survive too.
    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: PARENT,
      update: {
        sessionUpdate: "goal_updated",
        goal_id: "goal-1",
        objective: "fan out",
        status: "active",
        phase: "executing",
        tokens_used: 0,
        elapsed_ms: 0,
        total_deliverables: 0,
        completed_deliverables: 0,
        total_worker_rounds: 0,
        total_verify_rounds: 0,
      },
      eventId: "ev-goal",
    });
    dispatch.handleServerMsg({
      type: "state",
      session: goEmptyState(PARENT),
    });

    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: PARENT,
      update: {
        sessionUpdate: "task_backgrounded",
        tool_call_id: "call-bg",
        task_id: "task-bg-1",
        command: "sleep 10",
        cwd: "/proj",
      },
      eventId: "ev-bg",
    });
    dispatch.handleServerMsg({
      type: "state",
      session: goEmptyState(PARENT),
    });

    dispatch.handleServerMsg({
      type: "session_update",
      sessionId: PARENT,
      update: {
        sessionUpdate: "todos_update",
        todos: [{ content: "keep me", status: "pending" }],
      },
      eventId: "ev-todos",
    });
    dispatch.handleServerMsg({
      type: "state",
      session: goEmptyState(PARENT),
    });

    for (let i = 0; i < 4; i += 1) {
      const toolCallId = `call-spawn-${i + 1}`;
      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: PARENT,
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title: "spawn_subagent",
          kind: "other",
          status: "pending",
        },
        eventId: `ev-tool-${i}`,
      });
      dispatch.handleServerMsg({
        type: "state",
        session: goEmptyState(PARENT),
      });

      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: PARENT,
        update: {
          sessionUpdate: "subagent_spawned",
          subagent_id: IDS[i],
          child_session_id: IDS[i],
          parent_session_id: PARENT,
          parent_prompt_id: "prompt-round-1",
          subagent_type: "general-purpose",
          description: `Create demo ${i + 1}`,
          model: "grok-4.5",
        },
        eventId: `ev-spawn-${i}`,
      });
      // The accident: Go empty state immediately after each spawn.
      dispatch.handleServerMsg({
        type: "state",
        session: goEmptyState(PARENT),
      });
    }

    const final = last;
    assert.equal(Object.keys(final.subagents ?? {}).length, 4);
    for (const id of IDS) {
      assert.ok(final.subagents?.[id], `missing card ${id}`);
      assert.equal(final.subagents?.[id]?.status, "running");
    }
    assert.equal(final.goal?.goalId, "goal-1");
    assert.equal(final.backgroundTasks?.["task-bg-1"]?.taskId, "task-bg-1");
    assert.equal(final.todos?.length, 1);
    assert.ok((final.timeline?.length ?? 0) >= 1);
    // Bucket must match last onState/onSessionUpdate.
    const bucket = dispatch.bucketFor(PARENT);
    assert.equal(Object.keys(bucket.state.subagents ?? {}).length, 4);
  });

  it("catalog upsert + recordToSessionState round-trip keeps subagents", async () => {
    // Dynamic import keeps this survival suite on shipped catalog helpers.
    const { upsertFromLiveState } = await import("@/store/sessionCatalogUpsert");
    const { recordToSessionState } = await import(
      "@/store/sessionCatalogStorage"
    );
    const state = createSessionState({ id: PARENT, workspace: "/proj" });
    state.subagents = {
      [IDS[0]]: {
        subagentId: IDS[0],
        childSessionId: IDS[0],
        type: "general-purpose",
        description: "a",
        status: "running",
      },
      [IDS[1]]: {
        subagentId: IDS[1],
        childSessionId: IDS[1],
        type: "general-purpose",
        description: "b",
        status: "completed",
      },
    };
    state.subagentLinks = { [IDS[0]]: "c1", [IDS[1]]: "c2" };
    state.goal = {
      goalId: "g1",
      objective: "o",
      status: "active",
      phase: "executing",
      totalDeliverables: 0,
      completedDeliverables: 0,
      workerRounds: 0,
      verifyRounds: 0,
      tokensUsed: 0,
    };
    state.backgroundTasks = {
      t1: { taskId: "t1", command: "echo", status: "running" },
    };
    state.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hi" }],
      },
    ];

    let catalog = upsertFromLiveState([], state);
    // Empty live frame must not wipe cards (Go hydrate after catalog paint).
    const empty = goEmptyState(PARENT, "idle");
    catalog = upsertFromLiveState(catalog, empty);
    const rec = catalog.find((r) => r.id === PARENT);
    assert.ok(rec);
    assert.equal(Object.keys(rec!.subagents ?? {}).length, 2);
    assert.equal(rec!.goal?.goalId, "g1");
    assert.equal(rec!.backgroundTasks?.t1?.taskId, "t1");

    const restored = recordToSessionState(rec!);
    assert.equal(Object.keys(restored.subagents ?? {}).length, 2);
    assert.equal(restored.goal?.goalId, "g1");
    assert.equal(restored.subagentLinks?.[IDS[0]], "c1");
  });
});
