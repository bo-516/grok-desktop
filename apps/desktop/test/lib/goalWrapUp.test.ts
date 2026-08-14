/**
 * Goal wrap-up attaches last_event_detail to a dry (no trailing answer) turn.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TimelineItem } from "@grok-desktop/acp-core";
import {
  findGoalWrapUpUnitIndex,
  resolveGoalWrapUp,
  turnHasVisibleAnswer,
} from "@/lib/goalWrapUp";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";

/** User row used as a turn boundary. */
function user(id: string, text: string): TimelineItem {
  return { kind: "user", id, blocks: [{ type: "text", text }] };
}

/** Trailing agent answer (or mid-turn narration when tools follow). */
function agent(id: string, text: string): TimelineItem {
  return { kind: "agent", id, text };
}

/** Tool pointer that forces the turn into the activity rail. */
function tool(id: string, toolCallId: string): TimelineItem {
  return { kind: "tool", id, toolCallId };
}

/** Thought row so a tools-only turn still groups as a Worked rail. */
function thought(id: string, text: string): TimelineItem {
  return {
    kind: "thought",
    id,
    text,
    collapsed: true,
    startedAt: 1,
    completedAt: 2,
  };
}

describe("goalWrapUp", () => {
  it("fills the screenshot-shaped tool-only turn", () => {
    const timeline: TimelineItem[] = [
      user("u1", "Goal: @refactor-subagent-panel-inspector-2026-08-12.md"),
      thought("th1", "I can write a clear final response."),
      tool("t1", "tc-1"),
      tool("t2", "tc-2"),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "read" as const },
      "tc-2": { toolCallId: "tc-2", kind: "edit" as const },
    };
    const units = buildTimelineRenderUnits(timeline, tools);
    const detail =
      "Inspecting a subagent now stays in the Agents drawer. The main canvas never becomes the child.";
    const wrap = resolveGoalWrapUp(units, detail);
    assert.ok(wrap);
    assert.equal(wrap?.text, detail);
    const unit = units[wrap!.unitIndex];
    assert.equal(unit?.type, "turn");
    if (unit?.type === "turn") {
      assert.equal(unit.answer, undefined);
      assert.equal(turnHasVisibleAnswer(unit), false);
    }
  });

  it("does not wrap a turn that already has a trailing answer", () => {
    const timeline: TimelineItem[] = [
      user("u1", "hi"),
      tool("t1", "tc-1"),
      agent("a1", "Final answer."),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "read" as const },
    };
    const units = buildTimelineRenderUnits(timeline, tools);
    assert.equal(findGoalWrapUpUnitIndex(units, "worker said done"), -1);
    assert.equal(resolveGoalWrapUp(units, "worker said done"), undefined);
  });

  it("stays on the earlier dry turn when a later follow-up has an answer", () => {
    const timeline: TimelineItem[] = [
      user("u1", "goal"),
      tool("t1", "tc-1"),
      user("u2", "and also"),
      agent("a2", "Sure."),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "edit" as const },
    };
    const units = buildTimelineRenderUnits(timeline, tools);
    const wrap = resolveGoalWrapUp(units, "Worker finished the goal.");
    assert.ok(wrap);
    const unit = units[wrap!.unitIndex];
    assert.equal(unit?.type, "turn");
    if (unit?.type === "turn") {
      assert.equal(unit.answer, undefined);
    }
    // The later answered turn must not receive the wrap-up.
    const later = units.find(
      (u) => u.type === "turn" && u.answer?.item.text === "Sure.",
    );
    assert.ok(later);
    assert.notEqual(wrap?.unitIndex, units.indexOf(later!));
  });

  it("ignores blank detail and whitespace-only answers still count as dry", () => {
    const timeline: TimelineItem[] = [
      user("u1", "x"),
      tool("t1", "tc-1"),
    ];
    const tools = {
      "tc-1": { toolCallId: "tc-1", kind: "read" as const },
    };
    const units = buildTimelineRenderUnits(timeline, tools);
    assert.equal(resolveGoalWrapUp(units, "   "), undefined);
    assert.equal(resolveGoalWrapUp(units, undefined), undefined);
    const wrap = resolveGoalWrapUp(units, "  done.  ");
    assert.equal(wrap?.text, "done.");
  });
});
