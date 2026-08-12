/**
 * turn_completed usage parsing + context percent helpers.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  applySessionUpdate,
  contextUsagePercent,
  createSessionState,
  parsePromptResultUsage,
  parseTurnCompletedUsage,
  parseUsageBag,
  resetTimelineIdCounter,
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
  it("computes input / limit * 100 and returns null without a limit", () => {
    const usage = {
      inputTokens: 50_000,
      outputTokens: 1_000,
      totalTokens: 51_000,
    };
    assert.equal(contextUsagePercent(usage, 500_000), 10);
    assert.equal(contextUsagePercent(usage, null), null);
    assert.equal(contextUsagePercent(null, 500_000), null);
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
});
