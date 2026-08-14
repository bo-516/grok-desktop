/**
 * Session-rail preview / expand list model: 5-row preview, 8-row viewport.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROJECT_SESSION_EXPANDED_CAP,
  PROJECT_SESSION_PREVIEW,
  projectGroupListModel,
} from "@/lib/sessionRailPreview";

/** Sequential ids so slice / overflow assertions stay readable. */
function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `s${i + 1}`);
}

describe("sessionRailPreview", () => {
  it("keeps preview and expanded viewport caps at 5 and 8", () => {
    assert.equal(PROJECT_SESSION_PREVIEW, 5);
    assert.equal(PROJECT_SESSION_EXPANDED_CAP, 8);
  });

  it("hides every row when the folder is collapsed", () => {
    const model = projectGroupListModel(ids(40), true, true);
    assert.deepEqual(model, {
      visible: [],
      showMore: false,
      showLess: false,
      overflow: false,
      remaining: 0,
    });
  });

  it("clamps to the preview cap and reports remaining", () => {
    const sessions = ids(46);
    const model = projectGroupListModel(sessions, false, false);
    assert.deepEqual(model.visible, ids(5));
    assert.equal(model.showMore, true);
    assert.equal(model.showLess, false);
    assert.equal(model.overflow, false);
    assert.equal(model.remaining, 41);
  });

  it("skips more/less when the group fits in the preview", () => {
    const model = projectGroupListModel(ids(5), false, false);
    assert.equal(model.visible.length, 5);
    assert.equal(model.showMore, false);
    assert.equal(model.showLess, false);
    assert.equal(model.overflow, false);
  });

  it("shows every row plus Show less after expand under the viewport cap", () => {
    const sessions = ids(8);
    const model = projectGroupListModel(sessions, false, true);
    assert.deepEqual(model.visible, sessions);
    assert.equal(model.showMore, false);
    assert.equal(model.showLess, true);
    assert.equal(model.overflow, false);
    assert.equal(model.remaining, 0);
  });

  it("keeps the full list and flags overflow past 8 expanded rows", () => {
    const sessions = ids(46);
    const model = projectGroupListModel(sessions, false, true);
    assert.equal(model.visible.length, 46);
    assert.equal(model.showMore, false);
    assert.equal(model.showLess, true);
    assert.equal(model.overflow, true);
  });
});
