/**
 * Shell panel mutual-exclusion and plan auto-open pure helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contextRailAfterSessionChange,
  contextRailHasContent,
  contextRailWidthPx,
  openExclusivePanel,
  PLAN_RAIL_WIDTH,
  shouldAutoOpenPlanRail,
  toggleContextRail,
  toggleExclusivePanel,
} from "@/widgets/shell/shellPanels";

describe("shellPanels", () => {
  it("toggleExclusivePanel is mutually exclusive", () => {
    assert.equal(toggleExclusivePanel(null, "settings"), "settings");
    assert.equal(toggleExclusivePanel("settings", "settings"), null);
    assert.equal(toggleExclusivePanel("settings", "overview"), "overview");
    assert.equal(toggleExclusivePanel("overview", "environment"), "environment");
  });

  it("openExclusivePanel always opens (event path)", () => {
    assert.equal(openExclusivePanel(null, "environment"), "environment");
    assert.equal(openExclusivePanel("settings", "environment"), "environment");
  });

  it("toggleContextRail opens and closes plan and agents like mutual exclusion", () => {
    assert.equal(toggleContextRail(null, "plan"), "plan");
    assert.equal(toggleContextRail("plan", "plan"), null);
    assert.equal(toggleContextRail(null, "agents"), "agents");
    assert.equal(toggleContextRail("agents", "agents"), null);
    assert.equal(toggleContextRail("plan", "agents"), "agents");
    assert.equal(toggleContextRail("agents", "plan"), "plan");
  });

  it("shouldAutoOpenPlanRail respects manual close", () => {
    assert.equal(shouldAutoOpenPlanRail(0, null, false), false);
    assert.equal(shouldAutoOpenPlanRail(2, null, false), true);
    assert.equal(shouldAutoOpenPlanRail(2, "plan", false), false);
    assert.equal(shouldAutoOpenPlanRail(2, null, true), false);
  });

  it("shouldAutoOpenPlanRail does not steal an open preview or agents rail", () => {
    // openPreview sets contextRail to "preview"; plan auto-open must not flip it.
    assert.equal(shouldAutoOpenPlanRail(2, "preview", false), false);
    assert.equal(shouldAutoOpenPlanRail(1, "preview", false), false);
    assert.equal(shouldAutoOpenPlanRail(5, "preview", true), false);
    assert.equal(shouldAutoOpenPlanRail(2, "agents", false), false);
  });

  it("contextRailHasContent reserves push for any open rail (including empty)", () => {
    // Open Plan/Agents always push — empty states still squeeze transcript.
    assert.equal(contextRailHasContent("plan"), true);
    assert.equal(contextRailHasContent("agents"), true);
    assert.equal(contextRailHasContent("preview"), true);
    // Closed rail never reserves main-column width.
    assert.equal(contextRailHasContent(null), false);
  });

  it("contextRailWidthPx shares Plan|Agents width; preview stays independent", () => {
    assert.equal(contextRailWidthPx("plan", 560, 512), 512);
    assert.equal(contextRailWidthPx("agents", 560, 512), 512);
    assert.equal(contextRailWidthPx("plan", 560, 252), 252);
    assert.equal(contextRailWidthPx("preview", 560, 252), 560);
    assert.equal(contextRailWidthPx(null, 560, 252), PLAN_RAIL_WIDTH);
  });

  it("contextRailAfterSessionChange closes plan/agents only", () => {
    // New chat / catalog switch must not carry an empty companion drawer.
    assert.equal(contextRailAfterSessionChange("plan"), null);
    assert.equal(contextRailAfterSessionChange("agents"), null);
    // Preview and already-closed stay put.
    assert.equal(contextRailAfterSessionChange("preview"), "preview");
    assert.equal(contextRailAfterSessionChange(null), null);
  });
});
