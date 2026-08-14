/**
 * Three-tier shell layout: dock left, collapse left, overlay right.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSrc } from "../helpers/sourceFiles";
import {
  MAIN_COLUMN_MIN_WIDTH,
  resolveShellLayout,
  SIDEBAR_WIDTH_PX,
} from "@/lib/shellLayout";

const AGENTS = 300;
const PREVIEW = 560;

describe("resolveShellLayout", () => {
  it("keeps TS constants in sync with defineColor tokens", () => {
    const colors = readSrc("styles/defineColor.css");
    assert.match(colors, new RegExp(`--sidebar-width:\\s*${SIDEBAR_WIDTH_PX}px`));
    assert.match(
      colors,
      new RegExp(`--main-column-min-width:\\s*${MAIN_COLUMN_MIN_WIDTH}px`),
    );
  });

  it("docks the left rail when the right is closed and main min fits", () => {
    const wide = resolveShellLayout({
      viewportWidth: SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH,
      rightRailOpen: false,
      rightRailWidth: PREVIEW,
      drawerPref: "push",
    });
    assert.deepEqual(wide, { sidebarDocked: true, drawerLayout: "push" });

    const narrow = resolveShellLayout({
      viewportWidth: SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH - 1,
      rightRailOpen: false,
      rightRailWidth: PREVIEW,
      drawerPref: "push",
    });
    assert.deepEqual(narrow, { sidebarDocked: false, drawerLayout: "push" });
  });

  it("keeps three columns when sidebar + main min + rail fit", () => {
    const layout = resolveShellLayout({
      viewportWidth: SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH + AGENTS,
      rightRailOpen: true,
      rightRailWidth: AGENTS,
      drawerPref: "push",
    });
    assert.deepEqual(layout, { sidebarDocked: true, drawerLayout: "push" });
  });

  it("closes the left rail and still pushes when three columns do not fit", () => {
    const justTwo = SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH + PREVIEW - 1;
    const layout = resolveShellLayout({
      viewportWidth: justTwo,
      rightRailOpen: true,
      rightRailWidth: PREVIEW,
      drawerPref: "push",
    });
    assert.equal(layout.sidebarDocked, false);
    assert.equal(layout.drawerLayout, "push");
    assert.ok(justTwo >= MAIN_COLUMN_MIN_WIDTH + PREVIEW);
  });

  it("overlays the right rail when even two-column push would crush main", () => {
    const tooNarrow = MAIN_COLUMN_MIN_WIDTH + PREVIEW - 1;
    const layout = resolveShellLayout({
      viewportWidth: tooNarrow,
      rightRailOpen: true,
      rightRailWidth: PREVIEW,
      drawerPref: "push",
    });
    assert.deepEqual(layout, {
      sidebarDocked: false,
      drawerLayout: "overlay",
    });
  });

  it("uses the live rail width so a wide preview overlays sooner than agents", () => {
    const viewport = SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH + AGENTS;
    const withAgents = resolveShellLayout({
      viewportWidth: viewport,
      rightRailOpen: true,
      rightRailWidth: AGENTS,
      drawerPref: "push",
    });
    const withPreview = resolveShellLayout({
      viewportWidth: viewport,
      rightRailOpen: true,
      rightRailWidth: PREVIEW,
      drawerPref: "push",
    });
    assert.deepEqual(withAgents, { sidebarDocked: true, drawerLayout: "push" });
    assert.equal(withPreview.sidebarDocked, false);
    assert.equal(
      withPreview.drawerLayout,
      viewport >= MAIN_COLUMN_MIN_WIDTH + PREVIEW ? "push" : "overlay",
    );
  });

  it("honors overlay preference without rewriting the dock math for a closed rail", () => {
    const wide = resolveShellLayout({
      viewportWidth: 1600,
      rightRailOpen: true,
      rightRailWidth: PREVIEW,
      drawerPref: "overlay",
    });
    assert.deepEqual(wide, { sidebarDocked: true, drawerLayout: "overlay" });

    const slim = resolveShellLayout({
      viewportWidth: SIDEBAR_WIDTH_PX + MAIN_COLUMN_MIN_WIDTH - 1,
      rightRailOpen: false,
      rightRailWidth: PREVIEW,
      drawerPref: "overlay",
    });
    assert.deepEqual(slim, { sidebarDocked: false, drawerLayout: "overlay" });
  });

  it("treats non-positive viewport as fully overlay", () => {
    const layout = resolveShellLayout({
      viewportWidth: 0,
      rightRailOpen: true,
      rightRailWidth: PREVIEW,
      drawerPref: "push",
    });
    assert.deepEqual(layout, {
      sidebarDocked: false,
      drawerLayout: "overlay",
    });
  });
});
