/**
 * Shell panel mutual-exclusion and plan auto-open pure helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contextRailAfterSessionChange,
  contextRailHasContent,
  openExclusivePanel,
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

  it("contextRailHasContent keeps push stable across Plan|Agents tabs", () => {
    // Plan has steps, Agents empty — both tabs still count as content.
    assert.equal(contextRailHasContent("plan", 3, 0, false), true);
    assert.equal(contextRailHasContent("agents", 3, 0, false), true);
    // Agents has cards, Plan empty — same shared drawer.
    assert.equal(contextRailHasContent("plan", 0, 2, false), true);
    assert.equal(contextRailHasContent("agents", 0, 2, false), true);
    // Both surfaces have content.
    assert.equal(contextRailHasContent("plan", 1, 1, false), true);
    assert.equal(contextRailHasContent("agents", 1, 1, false), true);
    // Fully empty companion → overlay (do not squeeze transcript).
    assert.equal(contextRailHasContent("plan", 0, 0, false), false);
    assert.equal(contextRailHasContent("agents", 0, 0, false), false);
    // Background-task-only agent surface (agentItemCount includes tasks).
    assert.equal(contextRailHasContent("agents", 0, 1, false), true);
    assert.equal(contextRailHasContent("plan", 0, 1, false), true);
  });

  it("contextRailHasContent is independent for preview and closed rail", () => {
    assert.equal(contextRailHasContent("preview", 3, 2, true), true);
    assert.equal(contextRailHasContent("preview", 3, 2, false), false);
    // Preview emptiness is only about its target, not plan/agents counts.
    assert.equal(contextRailHasContent("preview", 0, 0, true), true);
    assert.equal(contextRailHasContent(null, 5, 5, true), false);
    assert.equal(contextRailHasContent(null, 0, 0, false), false);
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
