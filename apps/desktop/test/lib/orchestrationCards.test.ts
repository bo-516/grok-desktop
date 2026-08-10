/**
 * Tasks panel card sources: orchestration maps, not tool-call title regex.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
  type SubagentCard,
  type ToolCallCard,
} from "@grok-desktop/acp-core";
import {
  listOrchestrationBackgroundTasks,
  listOrchestrationSubagentCards,
} from "@/lib/orchestrationCards";

describe("orchestrationCards for Tasks panel", () => {
  it("card count matches Object.keys(session.subagents) from real apply path", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, {
      sessionUpdate: "subagent_spawned",
      subagent_id: "sa-1",
      child_session_id: "sa-1",
      subagent_type: "general-purpose",
      description: "goal plan writer",
      model: "grok-4.5",
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "subagent_spawned",
      subagent_id: "sa-2",
      child_session_id: "sa-2",
      subagent_type: "explore",
      description: "goal achievement skeptic",
      model: "grok-4.5",
    });
    const cards = listOrchestrationSubagentCards(state.subagents);
    assert.equal(cards.length, Object.keys(state.subagents ?? {}).length);
    assert.equal(cards.length, 2);
    assert.equal(cards[0]?.description, "goal plan writer");
    assert.equal(cards[1]?.status, "running");
  });

  it("does not list a normal tool card titled like Update the plan file", () => {
    const toolCalls: Record<string, ToolCallCard> = {
      t1: {
        toolCallId: "t1",
        title: "Update the plan file",
        kind: "edit",
        status: "completed",
      },
    };
    // Product path ignores toolCalls entirely for subagent cards.
    const subagents: Record<string, SubagentCard> = {
      "sa-real": {
        subagentId: "sa-real",
        childSessionId: "sa-real",
        type: "plan",
        description: "goal plan writer",
        status: "running",
      },
    };
    const cards = listOrchestrationSubagentCards(subagents);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.subagentId, "sa-real");
    assert.equal(
      cards.some((c) => c.description.includes("plan file")),
      false,
    );
    // Sanity: the false-positive title lives only on toolCalls, not cards.
    assert.equal(toolCalls.t1?.title, "Update the plan file");
  });

  it("lists background tasks from session.backgroundTasks", () => {
    let state = createSessionState({ id: "parent" });
    state = applySessionUpdate(state, {
      sessionUpdate: "task_backgrounded",
      task_id: "task-1",
      tool_call_id: "call-1",
      command: "npm run dev",
      description: "Start dev server",
    });
    const tasks = listOrchestrationBackgroundTasks(state.backgroundTasks);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.taskId, "task-1");
    assert.equal(tasks[0]?.status, "running");
  });
});
