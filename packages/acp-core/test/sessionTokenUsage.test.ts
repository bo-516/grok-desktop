/**
 * turn_completed usage parsing + context percent helpers.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  applyLiveContextOccupancy,
  applySessionUpdate,
  contextTokensForWindow,
  contextUsagePercent,
  createSessionState,
  extractSessionUpdate,
  mergeTurnUsagePreservingOccupancy,
  hasLiveContextOccupancy,
  parsePromptResultUsage,
  parseTokenUsageRpc,
  parseTurnCompletedUsage,
  parseUsageBag,
  parseUsageUpdate,
  resetTimelineIdCounter,
  stampLiveContextTokens,
  turnCompletedUpdateFromUsage,
} from "../src/timeline.js";

describe("parseTurnCompletedUsage", () => {
  it("reads the real grok-build usage bag", () => {
    const usage = parseTurnCompletedUsage({
      sessionUpdate: "turn_completed",
      prompt_id: "p1",
      stop_reason: "end_turn",
      usage: {
        inputTokens: 157694,
        outputTokens: 8433,
        totalTokens: 166127,
        cachedReadTokens: 117760,
        cacheCreationTokens: 0,
        reasoningTokens: 7691,
        modelCalls: 9,
        numTurns: 9,
      },
    });
    assert.deepEqual(usage, {
      inputTokens: 157694,
      outputTokens: 8433,
      totalTokens: 166127,
      cachedReadTokens: 117760,
      reasoningTokens: 7691,
      modelCalls: 9,
      numTurns: 9,
    });
  });

  it("returns null when core counters are missing or the kind differs", () => {
    assert.equal(
      parseTurnCompletedUsage({
        sessionUpdate: "turn_completed",
        usage: { inputTokens: 1 },
      }),
      null,
    );
    assert.equal(
      parseTurnCompletedUsage({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "x" },
      }),
      null,
    );
  });
});

describe("contextUsagePercent", () => {
  it("computes occupancy / limit * 100 and returns null without a limit", () => {
    const usage = {
      inputTokens: 50_000,
      outputTokens: 1_000,
      totalTokens: 51_000,
    };
    assert.equal(contextUsagePercent(usage, 500_000), 10);
    assert.equal(contextUsagePercent(usage, null), null);
    assert.equal(contextUsagePercent(null, 500_000), null);
  });

  it("prefers live contextTokensUsed over billed inputTokens", () => {
    const usage = {
      inputTokens: 1_200_000,
      outputTokens: 3_000,
      totalTokens: 1_203_000,
      contextTokensUsed: 183_111,
    };
    assert.ok(
      Math.abs((contextUsagePercent(usage, 500_000) ?? 0) - 36.6222) < 0.01,
    );
    assert.equal(contextTokensForWindow(usage), 183_111);
    assert.equal(
      contextTokensForWindow({
        inputTokens: 50_000,
        outputTokens: 0,
        totalTokens: 50_000,
      }),
      50_000,
    );
  });
});

describe("parsePromptResultUsage", () => {
  it("reads nested _meta.usage (imagePrompt probe shape)", () => {
    const usage = parsePromptResultUsage({
      stopReason: "end_turn",
      _meta: {
        usage: {
          inputTokens: 17484,
          outputTokens: 132,
          totalTokens: 17616,
          cachedReadTokens: 16512,
          reasoningTokens: 84,
          modelCalls: 1,
        },
      },
    });
    assert.deepEqual(usage, {
      inputTokens: 17484,
      outputTokens: 132,
      totalTokens: 17616,
      cachedReadTokens: 16512,
      reasoningTokens: 84,
      modelCalls: 1,
    });
  });

  it("reads top-level _meta counters when usage bag is absent", () => {
    const usage = parsePromptResultUsage({
      stopReason: "end_turn",
      _meta: {
        inputTokens: 16588,
        outputTokens: 242,
        totalTokens: 0,
        cachedReadTokens: 11264,
        reasoningTokens: 225,
      },
    });
    assert.equal(usage?.inputTokens, 16588);
    assert.equal(usage?.outputTokens, 242);
    assert.equal(usage?.totalTokens, 0);
  });

  it("returns null for missing or partial meta", () => {
    assert.equal(parsePromptResultUsage(null), null);
    assert.equal(parsePromptResultUsage({}), null);
    assert.equal(
      parsePromptResultUsage({ _meta: { inputTokens: 1 } }),
      null,
    );
  });
});

describe("parseUsageBag / turnCompletedUpdateFromUsage", () => {
  it("round-trips through a synthetic turn_completed update", () => {
    const bag = parseUsageBag({
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
    });
    assert.ok(bag);
    const update = turnCompletedUpdateFromUsage(bag!);
    assert.deepEqual(parseTurnCompletedUsage(update), bag);
  });
});

describe("applySessionUpdate turn_completed", () => {
  beforeEach(() => {
    resetTimelineIdCounter();
  });

  it("stores tokenUsage without timeline rows or thought finalization", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking… " },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 14178,
        outputTokens: 136,
        totalTokens: 14314,
        cachedReadTokens: 11264,
        reasoningTokens: 133,
        modelCalls: 1,
        numTurns: 1,
      },
    });
    assert.deepEqual(state.tokenUsage, {
      inputTokens: 14178,
      outputTokens: 136,
      totalTokens: 14314,
      cachedReadTokens: 11264,
      reasoningTokens: 133,
      modelCalls: 1,
      numTurns: 1,
    });
    assert.equal(state.timeline.length, 1);
    const thought = state.timeline[0];
    assert.ok(thought && thought.kind === "thought");
    if (thought?.kind === "thought") {
      assert.equal(thought.completedAt, undefined);
      assert.equal(thought.text, "thinking… ");
    }
  });

  it("overwrites previous usage on a later turn", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
      },
    });
    state = applySessionUpdate(state, {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 2000,
        outputTokens: 50,
        totalTokens: 2050,
      },
    });
    assert.equal(state.tokenUsage?.inputTokens, 2000);
    assert.equal(state.tokenUsage?.totalTokens, 2050);
  });

  it("keeps mid-turn occupancy when a later turn_completed overwrites billed counters", () => {
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "…" },
      _meta: { totalTokens: 80_000 },
    });
    assert.equal(state.tokenUsage?.contextTokensUsed, 80_000);
    state = applySessionUpdate(state, {
      sessionUpdate: "turn_completed",
      usage: {
        inputTokens: 1_200_000,
        outputTokens: 50,
        totalTokens: 1_200_050,
      },
    });
    assert.equal(state.tokenUsage?.inputTokens, 1_200_000);
    assert.equal(state.tokenUsage?.contextTokensUsed, 80_000);
    assert.ok(
      Math.abs((contextUsagePercent(state.tokenUsage, 500_000) ?? 0) - 16) <
        0.01,
    );
  });
});

describe("live context occupancy", () => {
  it("extractSessionUpdate stamps params._meta.totalTokens onto the update", () => {
    const u = extractSessionUpdate({
      sessionId: "s",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        _meta: { "x.ai/tool": { name: "grep" } },
      },
      _meta: { eventId: "s-1", totalTokens: 19365 },
    });
    assert.equal(u?.sessionUpdate, "tool_call");
    const meta = (u as { _meta?: { totalTokens?: number } })?._meta;
    assert.equal(meta?.totalTokens, 19365);
    assert.equal(
      (meta as { "x.ai/tool"?: { name?: string } })?.["x.ai/tool"]?.name,
      "grep",
    );
  });

  it("does not treat a bare update's _meta as occupancy params", () => {
    const u = extractSessionUpdate({
      sessionUpdate: "tool_call",
      _meta: { "x.ai/tool": { name: "grep" } },
    });
    assert.equal(
      (u as { _meta?: { totalTokens?: number } })?._meta?.totalTokens,
      undefined,
    );
  });

  it("applySessionUpdate refreshes occupancy from _meta.totalTokens mid-turn", () => {
    resetTimelineIdCounter();
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "thinking " },
      _meta: { totalTokens: 9117 },
    });
    assert.equal(state.tokenUsage?.contextTokensUsed, 9117);
    assert.equal(state.tokenUsage?.inputTokens, 9117);
    state = applySessionUpdate(state, {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "grep",
      _meta: { totalTokens: 19365 },
    });
    assert.equal(state.tokenUsage?.contextTokensUsed, 19365);
    const same = applySessionUpdate(state, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      _meta: { totalTokens: 19365 },
    });
    assert.equal(same.tokenUsage, state.tokenUsage);
  });

  it("stamp / merge / apply occupancy helpers are identity when unchanged", () => {
    const update = { sessionUpdate: "plan", _meta: { totalTokens: 10 } };
    assert.equal(
      stampLiveContextTokens(update, { totalTokens: 10 }),
      update,
    );
    const usage = {
      inputTokens: 1,
      outputTokens: 0,
      totalTokens: 1,
      contextTokensUsed: 10,
    };
    assert.equal(mergeTurnUsagePreservingOccupancy(usage, usage), usage);
    const state = { tokenUsage: usage };
    assert.equal(
      applyLiveContextOccupancy(state, { _meta: { totalTokens: 10 } }),
      state,
    );
  });

  it("does not invent a zero-only tokenUsage snapshot", () => {
    const state = createSessionState({ id: "s1" });
    const next = applyLiveContextOccupancy(state, { _meta: { totalTokens: 0 } });
    assert.equal(next, state);
    assert.equal(next.tokenUsage, undefined);
  });

  it("treats occupancy 0 as unset so billed input is used", () => {
    const usage = {
      inputTokens: 12_000,
      outputTokens: 10,
      totalTokens: 12_010,
      contextTokensUsed: 0,
    };
    assert.equal(contextTokensForWindow(usage), 12_000);
    assert.equal(hasLiveContextOccupancy(usage), false);
    const billed = {
      inputTokens: 20_000,
      outputTokens: 1,
      totalTokens: 20_001,
    };
    assert.equal(
      mergeTurnUsagePreservingOccupancy(billed, usage).contextTokensUsed,
      undefined,
    );
  });
});

describe("parseUsageUpdate", () => {
  it("stores ACP used as live occupancy", () => {
    const usage = parseUsageUpdate({
      sessionUpdate: "usage_update",
      used: 137_217,
      size: 500_000,
    });
    assert.equal(usage?.contextTokensUsed, 137_217);
    assert.equal(usage?.inputTokens, 137_217);
  });

  it("applySessionUpdate usage_update fills tokenUsage without a timeline row", () => {
    resetTimelineIdCounter();
    let state = createSessionState({ id: "s1" });
    state = applySessionUpdate(state, {
      sessionUpdate: "usage_update",
      used: 53_000,
      size: 200_000,
    });
    assert.equal(state.tokenUsage?.contextTokensUsed, 53_000);
    assert.equal(state.timeline.length, 0);
  });
});

describe("parseTokenUsageRpc", () => {
  it("prefers used / contextTokensUsed over billed totalTokens", () => {
    const usage = parseTokenUsageRpc({
      data: {
        used: 137_217,
        usage: {
          inputTokens: 4_772_614,
          outputTokens: 30_882,
          totalTokens: 4_803_496,
        },
      },
    });
    assert.equal(usage?.contextTokensUsed, 137_217);
    assert.equal(usage?.inputTokens, 4_772_614);
    assert.equal(usage?.totalTokens, 4_803_496);
  });

  it("reads a signals-like contextTokensUsed bag", () => {
    const usage = parseTokenUsageRpc({ contextTokensUsed: 126_902 });
    assert.equal(usage?.contextTokensUsed, 126_902);
    assert.equal(usage?.inputTokens, 126_902);
  });

  it("returns null for empty objects", () => {
    assert.equal(parseTokenUsageRpc(null), null);
    assert.equal(parseTokenUsageRpc({}), null);
  });
});
