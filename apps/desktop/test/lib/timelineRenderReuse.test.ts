/**
 * Settled render units keep their object identity while the tail turn streams,
 * which is what lets the memoized row skip those paints.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallCard } from "@grok-desktop/acp-core";
import {
  buildTimelineRenderUnits,
  timelineRenderUnitKey,
} from "@/lib/timelinePipeline";
import { reuseTimelineRenderUnits } from "@/lib/timelineRenderReuse";
import {
  appendAgentChunk,
  buildLongSession,
  LONG_SESSION_TURNS,
} from "../helpers/longTimelineFixture";
import { timelineUnitRowPropsEqual } from "@/widgets/timeline/timelineUnitRowPropsEqual";
import type { TimelineUnitRowWidgetProps } from "@/widgets/timeline/TimelineUnitRowWidget";

/** How many tail chunks the identity measurement applies. */
const CHUNKS = 20;

/**
 * Count units whose identity changed between two lists, split by the last key
 * (the streaming turn).
 * @param previous Prior unit list.
 * @param next Next unit list.
 */
function countIdentityChanges(
  previous: ReturnType<typeof buildTimelineRenderUnits>,
  next: ReturnType<typeof buildTimelineRenderUnits>,
): { settled: number; live: number; rows: number } {
  const liveKey = timelineRenderUnitKey(next[next.length - 1]!);
  let settled = 0;
  let live = 0;
  const length = Math.max(previous.length, next.length);
  for (let index = 0; index < length; index += 1) {
    const prior = previous[index];
    const unit = next[index];
    if (prior === unit) {
      continue;
    }
    const key = unit ? timelineRenderUnitKey(unit) : "";
    if (key === liveKey) {
      live += 1;
    } else {
      settled += 1;
    }
  }
  return { settled, live, rows: next.length };
}

describe("reuseTimelineRenderUnits", () => {
  it("keeps settled unit identity across a streaming tail", () => {
    const session = buildLongSession(LONG_SESSION_TURNS);
    let timeline = session.timeline;
    let previous = buildTimelineRenderUnits(timeline, session.toolCalls);
    const freshSettled: number[] = [];
    const reusedSettled: number[] = [];
    const reusedLive: number[] = [];
    const started = performance.now();

    for (let chunk = 0; chunk < CHUNKS; chunk += 1) {
      timeline = appendAgentChunk(timeline, ` tick${chunk}`);
      const built = buildTimelineRenderUnits(timeline, session.toolCalls);
      freshSettled.push(countIdentityChanges(previous, built).settled);
      const stable = reuseTimelineRenderUnits(previous, built);
      const delta = countIdentityChanges(previous, stable);
      reusedSettled.push(delta.settled);
      reusedLive.push(delta.live);
      previous = stable;
    }

    const fresh = freshSettled.reduce((sum, n) => sum + n, 0);
    const settled = reusedSettled.reduce((sum, n) => sum + n, 0);
    const live = reusedLive.reduce((sum, n) => sum + n, 0);
    console.log(
      `[timeline-reuse] turns=${LONG_SESSION_TURNS} chunks=${CHUNKS} rows=${previous.length} ` +
        `settled identity changes ${fresh} → ${settled} in ${(performance.now() - started).toFixed(1)}ms ` +
        `(live changes ${live})`,
    );

    assert.ok(fresh > 1000, `expected the unreduced path to rebuild settled rows, got ${fresh}`);
    assert.equal(settled, 0, "settled rows must keep their wrapper");
    assert.equal(live, CHUNKS, "the streaming turn changes once per chunk");
    assert.equal(previous.length, LONG_SESSION_TURNS * 2);
  });

  it("returns the same array when nothing in the timeline changed", () => {
    const session = buildLongSession(4);
    const first = buildTimelineRenderUnits(session.timeline, session.toolCalls);
    const second = buildTimelineRenderUnits(session.timeline, session.toolCalls);
    const stable = reuseTimelineRenderUnits(first, second);
    assert.equal(stable, first);
  });

  it("drops reuse for a row whose tool card object changed, and only that row", () => {
    const session = buildLongSession(3);
    const first = buildTimelineRenderUnits(session.timeline, session.toolCalls);
    const built = buildTimelineRenderUnits(session.timeline, session.toolCalls);
    const stable = reuseTimelineRenderUnits(first, built);
    const turn = stable.find((unit) => unit.type === "turn");
    const other = stable.filter((unit) => unit.type === "turn")[1];
    assert.ok(turn && turn.type === "turn");
    assert.ok(other && other.type === "turn");
    assert.equal(turn, first.find((unit) => unit.type === "turn"));

    const patched: ToolCallCard = {
      ...session.toolCalls["tc-0"]!,
      status: "failed",
    };
    const nextCalls = { ...session.toolCalls, "tc-0": patched };
    const base = rowProps(turn, session.toolCalls);
    assert.equal(
      timelineUnitRowPropsEqual(base, rowProps(turn, nextCalls)),
      false,
    );
    assert.equal(
      timelineUnitRowPropsEqual(rowProps(other, session.toolCalls), rowProps(other, nextCalls)),
      true,
    );
  });
});

/**
 * Minimal row props for the memo compare. Fields that are not under test stay fixed.
 * @param unit Render unit (reused or fresh).
 * @param toolCalls Card map for this paint.
 */
function rowProps(
  unit: TimelineUnitRowWidgetProps["unit"],
  toolCalls: Record<string, ToolCallCard | undefined>,
): TimelineUnitRowWidgetProps {
  return {
    unit,
    unitKey: timelineRenderUnitKey(unit),
    live: false,
    seeded: true,
    sessionStatus: "streaming",
    toolCalls,
    answerShowCursor: false,
    compact: false,
  };
}
