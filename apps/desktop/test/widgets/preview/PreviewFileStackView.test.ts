/**
 * File-preview refresh veil: last paint stays mounted; frost is class-driven.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { PreviewFileStackView } from "@/widgets/preview/PreviewFileStackView";
import { readAllUnoShortcuts } from "../../helpers/sourceFiles";

/**
 * Render the stack around a marker child so markup assertions stay local.
 * @param refreshing Whether the frost veil should be on.
 * @returns Static HTML of the stack.
 */
function renderStack(refreshing: boolean): string {
  return renderToStaticMarkup(
    createElement(
      PreviewFileStackView,
      { refreshing },
      createElement("pre", null, "kept"),
    ),
  );
}

describe("PreviewFileStackView", () => {
  it("keeps children mounted while idle and while refreshing", () => {
    assert.match(renderStack(false), />kept</);
    assert.match(renderStack(true), />kept</);
  });

  it("marks busy and turns the veil on only while refreshing", () => {
    const idle = renderStack(false);
    const busy = renderStack(true);
    assert.doesNotMatch(idle, /aria-busy/);
    assert.doesNotMatch(idle, /data-preview-refreshing/);
    assert.doesNotMatch(idle, /preview-refresh-veil-on/);
    assert.doesNotMatch(idle, /preview-file-stack-body-refreshing/);
    assert.match(busy, /aria-busy="true"/);
    assert.match(busy, /data-preview-refreshing="true"/);
    assert.match(busy, /preview-refresh-veil-on/);
    assert.match(busy, /preview-file-stack-body-refreshing/);
  });

  it("Uno shortcuts define the frost veil without color literals", () => {
    const shortcuts = readAllUnoShortcuts();
    assert.match(shortcuts, /"preview-refresh-veil":/);
    assert.match(shortcuts, /backdrop-blur-4px/);
    assert.match(shortcuts, /"preview-file-stack-body-refreshing":\s*"blur-2px"/);
    assert.doesNotMatch(shortcuts, /preview-refresh-veil.*#[0-9a-fA-F]{3,8}/);
  });
});
