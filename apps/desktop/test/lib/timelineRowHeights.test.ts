/**
 * Row height memory: measured border-box heights seed the next mount's
 * contain-intrinsic estimate so a rail switch lands on the real bottom.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  forgetTimelineRowHeights,
  noteTimelineRowHeight,
  rememberedTimelineRowHeight,
  TIMELINE_ROW_HEIGHT_CACHE_LIMIT,
} from "@/lib/timelineRowHeights";

describe("timelineRowHeights", () => {
  beforeEach(() => {
    forgetTimelineRowHeights();
  });

  it("returns undefined for a row never measured", () => {
    assert.equal(rememberedTimelineRowHeight("turn-none"), undefined);
  });

  it("round-trips a measured height", () => {
    noteTimelineRowHeight("turn-a", 512.4);
    assert.equal(rememberedTimelineRowHeight("turn-a"), 512.4);
  });

  it("ignores degenerate and malformed measurements", () => {
    noteTimelineRowHeight("turn-a", 0);
    noteTimelineRowHeight("turn-b", -20);
    noteTimelineRowHeight("turn-c", Number.NaN);
    noteTimelineRowHeight("", 200);
    assert.equal(rememberedTimelineRowHeight("turn-a"), undefined);
    assert.equal(rememberedTimelineRowHeight("turn-b"), undefined);
    assert.equal(rememberedTimelineRowHeight("turn-c"), undefined);
    assert.equal(rememberedTimelineRowHeight(""), undefined);
  });

  it("overwrites with the latest measurement", () => {
    noteTimelineRowHeight("turn-a", 300);
    noteTimelineRowHeight("turn-a", 480);
    assert.equal(rememberedTimelineRowHeight("turn-a"), 480);
  });

  it("evicts the least recently used key past the cache limit", () => {
    for (let i = 0; i < TIMELINE_ROW_HEIGHT_CACHE_LIMIT; i += 1) {
      noteTimelineRowHeight(`turn-${i}`, 100 + i);
    }
    noteTimelineRowHeight("turn-fresh", 999);
    assert.equal(rememberedTimelineRowHeight("turn-0"), undefined);
    assert.equal(rememberedTimelineRowHeight("turn-fresh"), 999);
  });

  it("a lookup marks the row recently used so it survives eviction", () => {
    for (let i = 0; i < TIMELINE_ROW_HEIGHT_CACHE_LIMIT; i += 1) {
      noteTimelineRowHeight(`turn-${i}`, 100 + i);
    }
    // Touch the oldest entry; the next insert should evict turn-1 instead.
    assert.equal(rememberedTimelineRowHeight("turn-0"), 100);
    noteTimelineRowHeight("turn-fresh", 999);
    assert.equal(rememberedTimelineRowHeight("turn-0"), 100);
    assert.equal(rememberedTimelineRowHeight("turn-1"), undefined);
  });

  it("forgetTimelineRowHeights clears every entry", () => {
    noteTimelineRowHeight("turn-a", 300);
    forgetTimelineRowHeights();
    assert.equal(rememberedTimelineRowHeight("turn-a"), undefined);
  });
});
