/**
 * Shell panel mutual-exclusion and plan auto-open pure helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  openExclusivePanel,
  shouldAutoOpenPlanRail,
  toggleContextRail,
  toggleExclusivePanel,
} from "@/widgets/shell/shellPanels";

describe("shellPanels", () => {
  it("toggleExclusivePanel is mutually exclusive", () => {
    assert.equal(toggleExclusivePanel(null, "settings"), "settings");
    assert.equal(toggleExclusivePanel("settings", "settings"), null);
    assert.equal(toggleExclusivePanel("settings", "tasks"), "tasks");
    assert.equal(toggleExclusivePanel("tasks", "overview"), "overview");
  });

  it("openExclusivePanel always opens (event path)", () => {
    assert.equal(openExclusivePanel(null, "extensions"), "extensions");
    assert.equal(openExclusivePanel("settings", "extensions"), "extensions");
  });

  it("toggleContextRail opens and closes plan", () => {
    assert.equal(toggleContextRail(null, "plan"), "plan");
    assert.equal(toggleContextRail("plan", "plan"), null);
  });

  it("shouldAutoOpenPlanRail respects manual close", () => {
    assert.equal(shouldAutoOpenPlanRail(0, null, false), false);
    assert.equal(shouldAutoOpenPlanRail(2, null, false), true);
    assert.equal(shouldAutoOpenPlanRail(2, "plan", false), false);
    assert.equal(shouldAutoOpenPlanRail(2, null, true), false);
  });

  it("shouldAutoOpenPlanRail does not steal an open preview rail", () => {
    // openPreview sets contextRail to "preview"; plan auto-open must not flip it.
    assert.equal(shouldAutoOpenPlanRail(2, "preview", false), false);
    assert.equal(shouldAutoOpenPlanRail(1, "preview", false), false);
    assert.equal(shouldAutoOpenPlanRail(5, "preview", true), false);
  });
});
