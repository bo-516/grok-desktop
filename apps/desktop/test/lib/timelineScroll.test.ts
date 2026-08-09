/**
 * Unit tests for timeline stick-to-bottom metrics.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isScrollNearBottom,
  scrollTopForBottom,
  TIMELINE_STICK_THRESHOLD_PX,
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
});
