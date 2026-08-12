/**
 * Minimal real-shaped spawn fan-out through shipped apply + grouping path.
 * Locks join keys and the single subagent_group render unit (design §7.6).
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  applySessionUpdate,
  createSessionState,
  resetTimelineIdCounter,
  type SessionState,
} from "@grok-desktop/acp-core";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";

const SPAWN_META = {
  "x.ai/tool": {
    version: 1,
    name: "spawn_subagent",
    kind: "task",
    namespace: "grok_build",
    label: "Subagent",
  },
};

const IDS = [
  "019feff5-9ef4-7623-91cb-1938fc28e831",
  "019feff5-9ef4-7623-91cb-1938fc28e832",
  "019feff5-9ef4-7623-91cb-1938fc28e833",
  "019feff5-9ef4-7623-91cb-1938fc28e834",
] as const;

/**
 * Real-shaped spawn body text with a subagent_id line.
 * @param id Subagent uuid.
 * @param description Role label.
 */
function spawnBody(id: string, description: string): string {
  return `Subagent started in background.
subagent_id: ${id}
type: general-purpose
description: ${description}

Use get_command_or_subagent_output with task_ids=["${id}"] and timeout_ms to wait for results.`;
}

/**
 * Apply a four-way fan-out with interleaved spawn completion / subagent_spawned
 * (card #4 completes after all four events — design §2.1).
 * @returns Session state after the full sequence.
 */
function applyFanOutSequence(): SessionState {
  let state = createSessionState({ id: "parent-fanout" });
  state = applySessionUpdate(state, {
    sessionUpdate: "user_message_chunk",
    content: { type: "text", text: "fan out demos" },
  });

  // Spawn cards open, then complete with body id; events interleave.
  for (let i = 0; i < 4; i += 1) {
    const toolCallId = `call-spawn-${i + 1}`;
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId,
      title: "spawn_subagent",
      kind: "other",
      status: "pending",
      _meta: SPAWN_META,
      rawInput: { description: `Create demo ${i + 1}`, prompt: "x".repeat(50) },
    });
    // Complete first three before their events; leave 4th incomplete until after events.
    if (i < 3) {
      state = applySessionUpdate(state, {
        sessionUpdate: "tool_call_update",
        toolCallId,
        title: `Create demo ${i + 1}`,
        status: "completed",
        content: [
          {
            type: "content",
            content: {
              type: "text",
              text: spawnBody(IDS[i]!, `Create demo ${i + 1}`),
            },
          },
        ],
      });
    }
  }

  // All four subagent_spawned events (after 3 completed cards, before card 4).
  for (let i = 0; i < 4; i += 1) {
    state = applySessionUpdate(state, {
      sessionUpdate: "subagent_spawned",
      subagent_id: IDS[i],
      child_session_id: IDS[i],
      parent_prompt_id: "prompt-round-1",
      subagent_type: "general-purpose",
      description: `Create demo ${i + 1}`,
      model: "grok-4.5",
    });
  }

  // Card 4 completes after all events (real interleave).
  state = applySessionUpdate(state, {
    sessionUpdate: "tool_call_update",
    toolCallId: "call-spawn-4",
    title: "Create demo 4",
    status: "completed",
    content: spawnBody(IDS[3]!, "Create demo 4"),
  });

  // Wait barrier.
  state = applySessionUpdate(state, {
    sessionUpdate: "tool_call",
    toolCallId: "call-wait",
    title: "get_command_or_subagent_output",
    kind: "other",
    status: "completed",
    _meta: {
      "x.ai/tool": { name: "get_command_or_subagent_output" },
    },
    rawInput: { task_ids: [...IDS] },
  });

  return state;
}

describe("subagent fan-out replay through shipped path", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("links four subagents and yields one subagent_group with zero error rows", () => {
    const state = applyFanOutSequence();

    const errors = state.timeline.filter((t) => t.kind === "error");
    assert.equal(errors.length, 0);

    assert.equal(Object.keys(state.subagents ?? {}).length, 4);
    for (const id of IDS) {
      const card = state.subagents?.[id];
      assert.ok(card, id);
      assert.ok(card?.toolCallId, `toolCallId linked for ${id}`);
      assert.equal(state.subagentLinks?.[id], card?.toolCallId);
    }

    // rawInput.prompt must not persist (sanitize drops it).
    for (const card of Object.values(state.toolCalls)) {
      assert.equal(card.rawInput?.prompt, undefined);
    }

    const units = buildTimelineRenderUnits(state.timeline, state.toolCalls);
    const groups = units.flatMap((u) => {
      if (u.type === "turn") {
        return u.activity.filter((c) => c.type === "subagent_group");
      }
      return u.type === "subagent_group" ? [u] : [];
    });
    assert.equal(groups.length, 1);
    const group = groups[0];
    assert.ok(group && group.type === "subagent_group");
    if (group && group.type === "subagent_group") {
      assert.equal(group.toolCallIds.length, 4);
      assert.equal(group.waitToolCallId, "call-wait");
    }
  });
});
