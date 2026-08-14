/**
 * Composer suggestion list: keep the keyboard highlight inside the
 * overflow port without scrolling the page.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scrollTopToRevealItem } from "@/widgets/composer/composerSuggestionScroll";

describe("scrollTopToRevealItem", () => {
  it("leaves scrollTop alone when the row is fully visible", () => {
    assert.equal(scrollTopToRevealItem(100, 400, 160, 220, 80), 80);
  });

  it("scrolls up when the row sits above the port", () => {
    // row top 80 vs port top 100 → move up 20
    assert.equal(scrollTopToRevealItem(100, 400, 80, 140, 80), 60);
  });

  it("scrolls down when the row sits below the port", () => {
    // row bottom 460 vs port bottom 400 → move down 60
    assert.equal(scrollTopToRevealItem(100, 400, 400, 460, 80), 140);
  });

  it("aligns to the port top when the row is taller than the port", () => {
    // item top is 60px above the port; 50 - 60 = -10 (the browser clamps to 0)
    assert.equal(scrollTopToRevealItem(100, 200, 40, 280, 50), -10);
  });
});
