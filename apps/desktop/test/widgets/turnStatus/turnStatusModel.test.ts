/**
 * Live-turn strip model — verb/detail resolution and the elapsed anchor.
 * Covers the shipped strings only; presentation lives in TurnStatusView.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import {
  resolveTurnStatus,
  turnStartedAtMs,
  TURN_STATUS_DEFAULT_VERB,
  TURN_STATUS_DETAIL_MAX,
} from "@/widgets/turnStatus/turnStatusModel";

/**
 * Build a thought row with an explicit start time.
 * @param id Row id (unique within a case).
 * @param text Body; may be empty to model a not-yet-streamed thought.
 * @param startedAt Epoch ms; 0 models a row the agent never timestamped.
 */
function thought(id: string, text: string, startedAt: number): TimelineItem {
  return { kind: "thought", id, text, collapsed: true, startedAt };
}

/** Tool row plus its card, keyed the way the session store stores them. */
function toolCase(card: ToolCallCard): {
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard>;
} {
  return {
    timeline: [{ kind: "tool", id: "t1", toolCallId: card.toolCallId }],
    toolCalls: { [card.toolCallId]: card },
  };
}

describe("resolveTurnStatus", () => {
  it("returns null unless the session is streaming", () => {
    for (const status of ["idle", "waiting_permission", "disconnected"]) {
      assert.equal(
        resolveTurnStatus({
          status,
          timeline: [thought("th1", "planning", 10)],
          toolCalls: {},
          workspace: "",
        }),
        null,
        `status ${status} must not mount the strip`,
      );
    }
  });

  it("streams with an empty timeline as the generic starting line", () => {
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [],
        toolCalls: {},
        workspace: "",
      }),
      { phase: "starting", verb: TURN_STATUS_DEFAULT_VERB, detail: "" },
    );
  });

  it("maps tool kinds to present-tense verbs and shortens path titles", () => {
    const { timeline, toolCalls } = toolCase({
      toolCallId: "c1",
      kind: "read",
      title: "Read /work/repo/src/App.tsx",
      status: "in_progress",
    });
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline,
        toolCalls,
        workspace: "/work/repo",
      }),
      { phase: "tool", verb: "Reading", detail: "Read src/App.tsx" },
    );
  });

  it("keeps the tool verb after the card completes (no flicker to Working)", () => {
    const { timeline, toolCalls } = toolCase({
      toolCallId: "c2",
      kind: "execute",
      title: "npm test",
      status: "completed",
    });
    const line = resolveTurnStatus({
      status: "streaming",
      timeline,
      toolCalls,
      workspace: "",
    });
    assert.equal(line?.verb, "Running");
  });

  it("falls back to Working for unknown kinds and missing cards", () => {
    const unknown = toolCase({
      toolCallId: "c3",
      kind: "teleport",
      title: "Teleport",
    });
    assert.equal(
      resolveTurnStatus({
        status: "streaming",
        timeline: unknown.timeline,
        toolCalls: unknown.toolCalls,
        workspace: "",
      })?.verb,
      TURN_STATUS_DEFAULT_VERB,
    );
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [{ kind: "tool", id: "t9", toolCallId: "missing" }],
        toolCalls: {},
        workspace: "",
      }),
      { phase: "tool", verb: TURN_STATUS_DEFAULT_VERB, detail: "" },
    );
  });

  it("previews the first line of a live thought", () => {
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [thought("th1", "\n  Checking the scroll handler\nthen…", 5)],
        toolCalls: {},
        workspace: "",
      }),
      { phase: "thinking", verb: "Thinking", detail: "Checking the scroll handler" },
    );
  });

  it("clips long details to the strip budget", () => {
    const long = "x".repeat(TURN_STATUS_DETAIL_MAX + 20);
    const detail = resolveTurnStatus({
      status: "streaming",
      timeline: [thought("th1", long, 5)],
      toolCalls: {},
      workspace: "",
    })?.detail;
    assert.equal(detail, `${"x".repeat(TURN_STATUS_DETAIL_MAX)}…`);
  });

  it("shows Responding with no detail while the answer streams", () => {
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [{ kind: "agent", id: "a1", text: "Here is the fix" }],
        toolCalls: {},
        workspace: "",
      }),
      { phase: "writing", verb: "Responding", detail: "" },
    );
  });

  it("shows the starting line right after the prompt is sent", () => {
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [{ kind: "user", id: "u1", blocks: [] }],
        toolCalls: {},
        workspace: "",
      }),
      { phase: "starting", verb: TURN_STATUS_DEFAULT_VERB, detail: "" },
    );
  });

  it("says Waiting on N subagents when the tail is still the user prompt", () => {
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [{ kind: "user", id: "u1", blocks: [] }],
        toolCalls: {},
        workspace: "",
        runningSubagents: 4,
      }),
      { phase: "starting", verb: "Waiting", detail: "4 subagents" },
    );
    assert.deepEqual(
      resolveTurnStatus({
        status: "streaming",
        timeline: [],
        toolCalls: {},
        workspace: "",
        runningSubagents: 1,
      }),
      { phase: "starting", verb: "Waiting", detail: "1 subagent" },
    );
  });
});

describe("turnStartedAtMs", () => {
  it("returns the first timestamped step of the current turn", () => {
    const timeline: TimelineItem[] = [
      thought("old", "previous turn", 100),
      { kind: "user", id: "u1", blocks: [] },
      thought("th1", "first", 500),
      { kind: "tool", id: "t1", toolCallId: "c1" },
      thought("th2", "second", 900),
    ];
    assert.equal(turnStartedAtMs(timeline), 500);
  });

  it("returns undefined for pure tool turns and empty timelines", () => {
    assert.equal(
      turnStartedAtMs([
        { kind: "user", id: "u1", blocks: [] },
        { kind: "tool", id: "t1", toolCallId: "c1" },
      ]),
      undefined,
    );
    assert.equal(turnStartedAtMs([]), undefined);
  });

  it("ignores rows the agent never timestamped", () => {
    assert.equal(turnStartedAtMs([thought("th1", "no clock", 0)]), undefined);
  });
});
