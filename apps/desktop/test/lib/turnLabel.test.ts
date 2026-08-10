/**
 * Turn rail label + auto-collapse helpers (shipped turnLabel.ts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
  it("collapses on live → done when user did not toggle and has answer", () => {
    assert.equal(
      shouldAutoCollapseTurn({
        prevLive: true,
        live: false,
        userToggled: false,
        hasAnswer: true,
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
        hasAnswer: true,
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
        hasAnswer: true,
      }),
      false,
    );
  });

  it("does not collapse tool-only turns (no answer)", () => {
    assert.equal(
      shouldAutoCollapseTurn({
        prevLive: true,
        live: false,
        userToggled: false,
        hasAnswer: false,
      }),
      false,
    );
  });
});
