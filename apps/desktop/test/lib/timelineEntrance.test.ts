/**
 * Entrance baseline: restored history must not replay the FadeContent entrance
 * when the user clicks around the session rail (shipped timelineEntrance.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceTimelineEntranceBaseline,
  EMPTY_TIMELINE_ENTRANCE_BASELINE,
  TIMELINE_ENTRANCE_WARM_MS,
} from "@/lib/timelineEntrance";

/** Just past the warm window so an advance reads as a live arrival. */
const AFTER_WARM = TIMELINE_ENTRANCE_WARM_MS + 1;

describe("advanceTimelineEntranceBaseline", () => {
  it("seeds every cached unit when a session is opened from the rail", () => {
    const next = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      {
        sessionId: "s-1",
        unitKeys: ["turn-a", "user-b"],
        restoringSessionId: null,
      },
      0,
    );
    assert.deepEqual([...next.seededUnitKeys], ["turn-a", "user-b"]);
    assert.equal(next.awaitingBody, false);
  });

  it("keeps live arrivals out of the baseline so they still animate", () => {
    const opened = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      { sessionId: "s-1", unitKeys: ["turn-a"], restoringSessionId: null },
      0,
    );
    const streamed = advanceTimelineEntranceBaseline(
      opened,
      {
        sessionId: "s-1",
        unitKeys: ["turn-a", "turn-b"],
        restoringSessionId: null,
      },
      AFTER_WARM,
    );
    assert.equal(streamed, opened, "same baseline object while session holds");
    assert.equal(streamed.seededUnitKeys.has("turn-a"), true);
    assert.equal(streamed.seededUnitKeys.has("turn-b"), false);
  });

  it("re-seeds on every rail switch, including back to a prior session", () => {
    const first = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      { sessionId: "s-1", unitKeys: ["turn-a"], restoringSessionId: null },
      0,
    );
    const second = advanceTimelineEntranceBaseline(
      first,
      {
        sessionId: "s-2",
        unitKeys: ["turn-x", "turn-y"],
        restoringSessionId: null,
      },
      0,
    );
    const back = advanceTimelineEntranceBaseline(
      second,
      {
        sessionId: "s-1",
        unitKeys: ["turn-a"],
        restoringSessionId: null,
      },
      0,
    );
    assert.deepEqual([...second.seededUnitKeys], ["turn-x", "turn-y"]);
    assert.deepEqual([...back.seededUnitKeys], ["turn-a"]);
  });

  it("adopts the replayed body of an uncached session as history", () => {
    const cold = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      { sessionId: "s-3", unitKeys: [], restoringSessionId: "s-3" },
      0,
    );
    assert.equal(cold.awaitingBody, true);
    const restored = advanceTimelineEntranceBaseline(
      cold,
      {
        sessionId: "s-3",
        unitKeys: ["turn-a", "turn-b"],
        restoringSessionId: null,
      },
      0,
    );
    assert.deepEqual([...restored.seededUnitKeys], ["turn-a", "turn-b"]);
    assert.equal(restored.awaitingBody, false);
  });

  it("adopts post-switch repartitions inside the warm window as history", () => {
    const opened = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      { sessionId: "s-1", unitKeys: ["turn-a"], restoringSessionId: null },
      0,
    );
    // Disk hydrate merges a new unit key ~600ms after the seeded paint.
    const hydrated = advanceTimelineEntranceBaseline(
      opened,
      {
        sessionId: "s-1",
        unitKeys: ["turn-a", "turn-b"],
        restoringSessionId: null,
      },
      600,
    );
    assert.equal(hydrated.seededUnitKeys.has("turn-b"), true);
    assert.equal(hydrated.awaitingBody, false);
  });

  it("keeps the baseline object when the warm window yields nothing new", () => {
    const opened = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      { sessionId: "s-1", unitKeys: ["turn-a"], restoringSessionId: null },
      0,
    );
    const rerender = advanceTimelineEntranceBaseline(
      opened,
      {
        sessionId: "s-1",
        unitKeys: ["turn-a"],
        restoringSessionId: null,
      },
      600,
    );
    assert.equal(rerender, opened);
  });

  it("treats a wholesale id rewrite as restored history, not live arrivals", () => {
    const opened = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      {
        sessionId: "s-1",
        unitKeys: ["parent-a", "parent-b"],
        restoringSessionId: null,
      },
      0,
    );
    const rewritten = advanceTimelineEntranceBaseline(
      opened,
      {
        sessionId: "s-1",
        unitKeys: ["child-a", "child-b"],
        restoringSessionId: null,
      },
      600,
    );
    assert.deepEqual([...rewritten.seededUnitKeys], ["child-a", "child-b"]);
    assert.equal(rewritten.awaitingBody, false);
  });

  it("lets a new chat's first message animate (empty, but not restoring)", () => {
    const draft = advanceTimelineEntranceBaseline(
      EMPTY_TIMELINE_ENTRANCE_BASELINE,
      { sessionId: "", unitKeys: [], restoringSessionId: null },
      0,
    );
    assert.equal(draft.awaitingBody, false);
    const sent = advanceTimelineEntranceBaseline(
      draft,
      {
        sessionId: "",
        unitKeys: ["user-1"],
        restoringSessionId: null,
      },
      AFTER_WARM,
    );
    assert.equal(sent.seededUnitKeys.has("user-1"), false);
  });
});
