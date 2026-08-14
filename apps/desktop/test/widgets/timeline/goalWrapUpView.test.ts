/**
 * Goal wrap-up paints as the turn answer (Copy + Markdown) on a dry turn.
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import type { TimelineItem } from "@grok-desktop/acp-core";
import { buildTimelineRenderUnits } from "@/lib/timelinePipeline";
import { resolveGoalWrapUp } from "@/lib/goalWrapUp";
import { isTurnLive } from "@/lib/turnGrouping";

register(new URL("../../helpers/cssHooks.mjs", import.meta.url));

/** Screenshot-shaped goal turn: user + thought + tools, no trailing answer. */
function dryGoalTimeline(): TimelineItem[] {
  return [
    {
      kind: "user",
      id: "u1",
      blocks: [
        {
          type: "text",
          text: "Goal: @refactor-subagent-panel-inspector-2026-08-12.md",
        },
      ],
    },
    {
      kind: "thought",
      id: "th1",
      text: "I can write a clear final response.",
      collapsed: true,
      startedAt: 1,
      completedAt: 2,
    },
    { kind: "tool", id: "t1", toolCallId: "tc-1" },
  ];
}

describe("goal wrap-up view", () => {
  it("renders last_event_detail as the turn answer on a dry Goal turn", async () => {
    const { TimelineView } = await import("@/widgets/timeline/TimelineView");
    const timeline = dryGoalTimeline();
    const toolCalls = {
      "tc-1": { toolCallId: "tc-1", kind: "edit" as const, title: "edit file" },
    };
    const units = buildTimelineRenderUnits(timeline, toolCalls);
    const detail =
      "Inspecting a subagent now stays in the Agents drawer. The main canvas never becomes the child.";
    const wrap = resolveGoalWrapUp(units, detail);
    assert.ok(wrap);
    const html = renderToStaticMarkup(
      createElement(TimelineView, {
        timeline,
        toolCalls,
        status: "idle",
        units,
        seededUnitKeys: new Set<string>(),
        isRestoring: false,
        isEmpty: false,
        scrollRef: { current: null },
        handleScroll: () => undefined,
        isTurnLive,
        compact: true,
        wrapUpIndex: wrap?.unitIndex,
        wrapUpText: wrap?.text,
      }),
    );
    assert.match(html, /data-kind="turn-answer"/);
    assert.match(html, /data-wrap-up="1"/);
    assert.match(html, /Inspecting a subagent now stays in the Agents drawer/);
    assert.match(html, />Copy</);
  });

  it("does not mark a real trailing answer as wrap-up", async () => {
    const { TimelineView } = await import("@/widgets/timeline/TimelineView");
    const timeline: TimelineItem[] = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hi" }],
      },
      { kind: "tool", id: "t1", toolCallId: "tc-1" },
      { kind: "agent", id: "a1", text: "Final answer from the agent." },
    ];
    const toolCalls = {
      "tc-1": { toolCallId: "tc-1", kind: "read" as const },
    };
    const units = buildTimelineRenderUnits(timeline, toolCalls);
    const wrap = resolveGoalWrapUp(units, "Should not appear.");
    assert.equal(wrap, undefined);
    const html = renderToStaticMarkup(
      createElement(TimelineView, {
        timeline,
        toolCalls,
        status: "idle",
        units,
        seededUnitKeys: new Set<string>(),
        isRestoring: false,
        isEmpty: false,
        scrollRef: { current: null },
        handleScroll: () => undefined,
        isTurnLive,
        compact: true,
        wrapUpIndex: -1,
        wrapUpText: "Should not appear.",
      }),
    );
    assert.match(html, /Final answer from the agent/);
    assert.doesNotMatch(html, /data-wrap-up="1"/);
    assert.doesNotMatch(html, /Should not appear/);
  });
});
