/**
 * Overflow helpers: clip detection + tip placement for GitHub-length pretexts.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
  GITHUB_OVERFLOW_PRETEXT,
  isOverflowingX,
  placeOverflowTip,
} from "@/lib/overflowText";
import { OverflowTextView } from "@/widgets/shared";

describe("overflowText", () => {
  it("treats a GitHub pretext as clipped when scrollWidth exceeds the cell", () => {
    assert.equal(GITHUB_OVERFLOW_PRETEXT.includes("github.com"), true);
    assert.equal(
      isOverflowingX({
        scrollWidth: GITHUB_OVERFLOW_PRETEXT.length * 7,
        clientWidth: 200,
      }),
      true,
    );
    assert.equal(
      isOverflowingX({ scrollWidth: 200, clientWidth: 200 }),
      false,
    );
  });

  it("hangs the tip from the cell's bottom-right corner", () => {
    const box = placeOverflowTip(
      { left: 700, top: 100, right: 900, bottom: 124, width: 200 },
      { width: 1400, height: 800 },
    );
    assert.equal(box.above, false);
    assert.equal(box.left, 812);
    assert.equal(box.top, 128);
    assert.equal(box.maxWidth, 420);
  });

  it("keeps the corner and shrinks width before sliding left", () => {
    const box = placeOverflowTip(
      { left: 700, top: 100, right: 900, bottom: 124, width: 200 },
      { width: 1200, height: 800 },
    );
    assert.equal(box.above, false);
    assert.equal(box.left, 812);
    assert.equal(box.top, 128);
    assert.equal(box.maxWidth, 376);
  });

  it("slides left only when the right gutter cannot hold the minimum width", () => {
    const box = placeOverflowTip(
      { left: 620, top: 80, right: 780, bottom: 104, width: 160 },
      { width: 800, height: 600 },
    );
    assert.equal(box.above, false);
    assert.equal(box.left, 368);
    assert.equal(box.top, 108);
    assert.equal(box.maxWidth, 420);
  });

  it("flips to the top-right when the cell sits near the viewport floor", () => {
    const box = placeOverflowTip(
      { left: 700, top: 520, right: 900, bottom: 544, width: 200 },
      { width: 1400, height: 600 },
    );
    assert.equal(box.above, true);
    assert.equal(box.left, 812);
    assert.equal(box.bottom, 84);
    assert.equal(box.top, undefined);
  });

  it("renders the GitHub pretext inside the truncated cell", () => {
    const html = renderToStaticMarkup(
      createElement(OverflowTextView, {
        text: GITHUB_OVERFLOW_PRETEXT,
        className: "palette-desc",
      }),
    );
    assert.match(html, /palette-desc/);
    assert.match(html, /github\.com\/bo-516\/grok-desktop/);
    assert.doesNotMatch(html, /overflow-tip-pre/);
  });
});
