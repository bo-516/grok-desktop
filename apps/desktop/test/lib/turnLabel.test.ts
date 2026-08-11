/**
 * Turn rail label + auto-collapse helpers (shipped turnLabel.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDoneActivitySummary,
  formatTurnLabel,
  formatWorkedDuration,
  shouldAutoCollapseTurn,
  TURN_STEP_PREVIEW_MAX,
} from "@/lib/turnLabel";

describe("formatWorkedDuration", () => {
  it("formats sub-minute work as seconds", () => {
    assert.equal(formatWorkedDuration(3000), "3s");
    assert.equal(formatWorkedDuration(200), "1s");
  });

  it("formats multi-minute work as m + s (Codex style)", () => {
    assert.equal(formatWorkedDuration(188_000), "3m 8s");
    assert.equal(formatWorkedDuration(60_000), "1m 0s");
  });

  it("formats hours and days without minute inflation", () => {
    assert.equal(formatWorkedDuration(3_600_000), "1h");
    assert.equal(formatWorkedDuration(3_720_000), "1h 2m");
    assert.equal(formatWorkedDuration(86_400_000 + 5 * 3_600_000), "1d 5h");
    // 2224 minutes must not print as "2224m …"
    assert.equal(formatWorkedDuration(2224 * 60_000), "1d 13h");
  });
});

describe("formatTurnLabel", () => {
  it("live with current-step preview", () => {
    assert.equal(
      formatTurnLabel({
        live: true,
        totalMs: 0,
        steps: 3,
        currentStepPreview: "Read mentionTokens.ts",
      }),
      "Working · Read mentionTokens.ts",
    );
  });

  it("live without current step is Working…", () => {
    assert.equal(
      formatTurnLabel({ live: true, totalMs: 5000, steps: 2 }),
      "Working…",
    );
  });

  it("live preview truncates at TURN_STEP_PREVIEW_MAX with ellipsis", () => {
    const long = "x".repeat(TURN_STEP_PREVIEW_MAX + 10);
    const label = formatTurnLabel({
      live: true,
      totalMs: 0,
      steps: 1,
      currentStepPreview: long,
    });
    assert.equal(
      label,
      `Working · ${"x".repeat(TURN_STEP_PREVIEW_MAX)}…`,
    );
    assert.ok(label.length <= `Working · ${"x".repeat(TURN_STEP_PREVIEW_MAX)}…`.length);
  });

  it("done with duration and steps > 1", () => {
    assert.equal(
      formatTurnLabel({ live: false, totalMs: 188_000, steps: 12 }),
      "Worked for 3m 8s · 12 steps",
    );
  });

  it("done label appends activity summary for collapsed rails", () => {
    assert.equal(
      formatTurnLabel({
        live: false,
        totalMs: 188_000,
        steps: 12,
        activitySummary: "3 read tools · 2 thoughts",
      }),
      "Worked for 3m 8s · 12 steps · 3 read tools · 2 thoughts",
    );
  });

  it("formatDoneActivitySummary mixes tools and thoughts", () => {
    const summary = formatDoneActivitySummary([
      {
        type: "tool_group",
        id: "tg1",
        toolCallIds: ["a", "b"],
        kinds: ["read", "edit"],
        count: 2,
      },
      {
        type: "thought_group",
        id: "th1",
        itemIds: ["t1", "t2"],
        items: [
          { kind: "thought", id: "t1", text: "a" },
          { kind: "thought", id: "t2", text: "b" },
        ],
        count: 2,
        totalMs: 1000,
      },
    ] as never);
    assert.match(summary, /2 /);
    assert.match(summary, /thought/);
  });

  it("done with duration and steps ≤ 1 omits steps suffix", () => {
    assert.equal(
      formatTurnLabel({ live: false, totalMs: 3000, steps: 1 }),
      "Worked for 3s",
    );
    assert.equal(
      formatTurnLabel({ live: false, totalMs: 3000, steps: 0 }),
      "Worked for 3s",
    );
  });

  it("done without duration does not fabricate seconds", () => {
    assert.equal(
      formatTurnLabel({ live: false, totalMs: 0, steps: 12 }),
      "Worked · 12 steps",
    );
    assert.equal(
      formatTurnLabel({ live: false, totalMs: 0, steps: 1 }),
      "Worked",
    );
  });

  it("cancelled uses Stopped-style label", () => {
    assert.equal(
      formatTurnLabel({
        live: false,
        totalMs: 12_000,
        steps: 5,
        cancelled: true,
      }),
      "Stopped after 12s · 5 steps",
    );
    assert.equal(
      formatTurnLabel({
        live: false,
        totalMs: 0,
        steps: 2,
        cancelled: true,
      }),
      "Stopped · 2 steps",
    );
  });
});

describe("shouldAutoCollapseTurn", () => {
  it("collapses on live → done when user did not toggle", () => {
    assert.equal(
      shouldAutoCollapseTurn({
        prevLive: true,
        live: false,
        userToggled: false,
      }),
      true,
    );
  });

  it("does not collapse when the user already toggled", () => {
    assert.equal(
      shouldAutoCollapseTurn({
        prevLive: true,
        live: false,
        userToggled: true,
      }),
      false,
    );
  });

  it("does not re-collapse when already done", () => {
    assert.equal(
      shouldAutoCollapseTurn({
        prevLive: false,
        live: false,
        userToggled: false,
      }),
      false,
    );
  });

  it("collapses tool-only turns on live → done (history stays collapsed)", () => {
    assert.equal(
      shouldAutoCollapseTurn({
        prevLive: true,
        live: false,
        userToggled: false,
      }),
      true,
    );
  });
});
