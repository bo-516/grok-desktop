/**
 * Pure mode cycle / label / pending reconcile tests — drives shipped helpers only.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_MODE_OPTIONS,
  isPendingModeResolved,
  modeLabel,
  nextMode,
  normalizeAgentMode,
} from "@/widgets/composer/composerModes";

describe("composerModes", () => {
  it("cycles build → plan → ask → build", () => {
    assert.equal(nextMode("build"), "plan");
    assert.equal(nextMode("plan"), "ask");
    assert.equal(nextMode("ask"), "build");
  });

  it("unknown mode normalizes to build then advances to plan", () => {
    assert.equal(normalizeAgentMode("weird"), "build");
    assert.equal(normalizeAgentMode(undefined), "build");
    assert.equal(normalizeAgentMode(null), "build");
    assert.equal(nextMode("weird"), "plan");
    assert.equal(nextMode(undefined), "plan");
  });

  it("modeLabel maps ids and falls back safely", () => {
    assert.equal(modeLabel("ask"), "Ask");
    assert.equal(modeLabel("plan"), "Plan");
    assert.equal(modeLabel("build"), "Build");
    assert.equal(modeLabel("nope"), "Build");
  });

  it("catalog covers all three modes with descriptions", () => {
    assert.equal(AGENT_MODE_OPTIONS.length, 3);
    for (const opt of AGENT_MODE_OPTIONS) {
      assert.ok(opt.label.length > 0);
      assert.ok(opt.description.length > 0);
    }
  });

  it("pendingMode resolves only when confirmed matches", () => {
    assert.equal(isPendingModeResolved(null, "build"), true);
    assert.equal(isPendingModeResolved("plan", "build"), false);
    assert.equal(isPendingModeResolved("plan", "plan"), true);
    assert.equal(isPendingModeResolved("ask", "weird"), false);
  });
});
