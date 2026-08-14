/**
 * Change-list summary chrome: labeled prefs collapse to icons in markup
 * (CSS container query picks the face). Pressed toggles keep aria-pressed.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { DiffChangeListChrome } from "@/widgets/preview/DiffChangeListChrome";

/**
 * Render the chrome with shared prefs so all four actions paint.
 * @param allCollapsed Whether the bulk control reads as Expand all.
 * @returns Static HTML of the summary strip.
 */
function renderChrome(allCollapsed: boolean): string {
  return renderToStaticMarkup(
    createElement(DiffChangeListChrome, {
      summary: "Edited 2 files",
      allCollapsed,
      onCollapseAll: () => undefined,
      onExpandAll: () => undefined,
      viewPrefs: {
        wrap: true,
        dualGutter: false,
        preferFullFile: true,
      },
      onViewPrefsChange: () => undefined,
    }),
  );
}

describe("DiffChangeListChrome compact actions", () => {
  it("keeps both icon and label faces on each pref button", () => {
    const html = renderChrome(false);
    assert.match(html, /preview-change-summary-actions/);
    assert.match(html, /preview-change-summary-action-icon/);
    assert.match(html, /preview-change-summary-action-label/);
    assert.match(html, /Show full file/);
    assert.match(html, /Wrap/);
    assert.match(html, /Dual #/);
    assert.match(html, /Collapse all/);
    assert.match(html, /aria-label="Show full file"/);
    assert.match(html, /aria-label="Wrap"/);
    assert.match(html, /aria-label="Dual #"/);
    assert.match(html, /aria-label="Collapse all"/);
  });

  it("marks sticky toggles pressed and paints the check on the label", () => {
    const html = renderChrome(false);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /✓ Show full file/);
    assert.match(html, /✓ Wrap/);
    assert.doesNotMatch(html, /✓ Dual/);
    assert.match(html, /preview-change-summary-action-on/);
  });

  it("swaps collapse / expand label from allCollapsed", () => {
    const collapsed = renderChrome(true);
    assert.match(collapsed, /Expand all/);
    assert.doesNotMatch(collapsed, /Collapse all/);
    const expanded = renderChrome(false);
    assert.match(expanded, /Collapse all/);
    assert.doesNotMatch(expanded, /Expand all/);
  });
});
