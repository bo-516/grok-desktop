/**
 * Unit tests for timeline stick-to-bottom metrics.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceTimelineSettle,
  INITIAL_TIMELINE_SETTLE_STATE,
  isEdgeNear,
  isScrollNearBottom,
  scrollDeltaToAlignBottoms,
  scrollTopForBottom,
  shouldRepinOnEnable,
  stickAfterScroll,
  TIMELINE_SETTLE_FRAME_BUDGET,
  TIMELINE_STICK_THRESHOLD_PX,
  type TimelineSettleState,
} from "@/lib/timelineScroll";

describe("timelineScroll", () => {
  it("isScrollNearBottom is false without an element", () => {
    assert.equal(isScrollNearBottom(null), false);
    assert.equal(isScrollNearBottom(undefined), false);
  });

  it("isScrollNearBottom treats content that fits as near bottom", () => {
    assert.equal(
      isScrollNearBottom({
        scrollTop: 0,
        scrollHeight: 400,
        clientHeight: 500,
      }),
      true,
    );
  });

  it("isScrollNearBottom uses the threshold band", () => {
    const el = {
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 400,
    };
    // distance = 1000 - 100 - 400 = 500 → not near with default threshold
    assert.equal(isScrollNearBottom(el), false);
    assert.equal(isScrollNearBottom(el, 500), true);
    assert.equal(isScrollNearBottom(el, 499), false);
  });

  it("isScrollNearBottom clamps negative thresholds to 0", () => {
    const el = {
      scrollTop: 600,
      scrollHeight: 1000,
      clientHeight: 400,
    };
    // distance = 0
    assert.equal(isScrollNearBottom(el, -10), true);
    const slightlyUp = { ...el, scrollTop: 599 };
    assert.equal(isScrollNearBottom(slightlyUp, -10), false);
  });

  it("scrollTopForBottom returns max offset and 0 for short content", () => {
    assert.equal(scrollTopForBottom(null), 0);
    assert.equal(
      scrollTopForBottom({ scrollHeight: 1200, clientHeight: 400 }),
      800,
    );
    assert.equal(
      scrollTopForBottom({ scrollHeight: 300, clientHeight: 400 }),
      0,
    );
  });

  it("exports a positive default threshold", () => {
    assert.ok(TIMELINE_STICK_THRESHOLD_PX > 0);
  });

  it("shouldRepinOnEnable only fires on the false→true edge", () => {
    assert.equal(shouldRepinOnEnable(false, true), true);
    assert.equal(shouldRepinOnEnable(true, true), false);
    assert.equal(shouldRepinOnEnable(true, false), false);
    assert.equal(shouldRepinOnEnable(false, false), false);
  });

  it("isEdgeNear pins when a thought tail sits on the rail fold", () => {
    assert.equal(isEdgeNear(400, 400), true);
    assert.equal(isEdgeNear(400, 400 - TIMELINE_STICK_THRESHOLD_PX), true);
    assert.equal(isEdgeNear(400, 400 + TIMELINE_STICK_THRESHOLD_PX), true);
    assert.equal(isEdgeNear(400, 400 - TIMELINE_STICK_THRESHOLD_PX - 1), false);
    assert.equal(isEdgeNear(400, 400 + TIMELINE_STICK_THRESHOLD_PX + 1), false);
  });

  it("scrollDeltaToAlignBottoms is the signed tail gap", () => {
    assert.equal(scrollDeltaToAlignBottoms(400, 480), 80);
    assert.equal(scrollDeltaToAlignBottoms(400, 350), -50);
    assert.equal(scrollDeltaToAlignBottoms(400, 400), 0);
  });

  it("stickAfterScroll keeps the pin on its own short-jump echo", () => {
    // Session-switch write landed at the estimated bottom; rows resolved
    // taller afterwards so the offset sits far above the new bottom.
    assert.equal(
      stickAfterScroll({
        wasStuck: true,
        previousTop: 4000,
        currentTop: 4000,
        nearBottom: false,
      }),
      true,
    );
  });

  it("stickAfterScroll detaches only on a real upward gesture", () => {
    assert.equal(
      stickAfterScroll({
        wasStuck: true,
        previousTop: 4000,
        currentTop: 3999,
        nearBottom: false,
      }),
      true,
    );
    assert.equal(
      stickAfterScroll({
        wasStuck: true,
        previousTop: 4000,
        currentTop: 3000,
        nearBottom: false,
      }),
      false,
    );
  });

  it("stickAfterScroll does not re-attach on a mid-scroll downward gesture", () => {
    assert.equal(
      stickAfterScroll({
        wasStuck: false,
        previousTop: 1000,
        currentTop: 1500,
        nearBottom: false,
      }),
      false,
    );
    assert.equal(
      stickAfterScroll({
        wasStuck: false,
        previousTop: 1000,
        currentTop: 1500,
        nearBottom: true,
      }),
      true,
    );
  });

  it("advanceTimelineSettle repins while the bottom drifts and stops when stable", () => {
    const drift = advanceTimelineSettle(INITIAL_TIMELINE_SETTLE_STATE, 1080);
    assert.equal(drift.repin, true);
    assert.equal(drift.done, false);
    assert.equal(drift.stableFrames, 0);

    const firstHold = advanceTimelineSettle(drift, 0);
    assert.equal(firstHold.repin, false);
    assert.equal(firstHold.done, false);

    const secondHold = advanceTimelineSettle(firstHold, 0.5);
    assert.equal(secondHold.done, true);
  });

  it("advanceTimelineSettle spends its frame budget on endless drift", () => {
    let state: TimelineSettleState = INITIAL_TIMELINE_SETTLE_STATE;
    let done = false;
    for (let i = 0; i < TIMELINE_SETTLE_FRAME_BUDGET; i += 1) {
      const frame = advanceTimelineSettle(state, 500);
      done = frame.done;
      state = frame;
    }
    assert.equal(done, true);
  });
});
