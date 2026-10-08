/**
 * Computed CSS color → xterm sRGB conversion (terminal theme input).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cssColorToXterm,
  formatXtermColor,
  parseCssColor,
} from "@/lib/cssColorToSrgb";

describe("cssColorToSrgb", () => {
  it("passes hex and rgb() through in xterm's preferred shape", () => {
    assert.equal(cssColorToXterm("#CD3131"), "#cd3131");
    assert.equal(cssColorToXterm("#abc"), "#aabbcc");
    assert.equal(cssColorToXterm("rgb(13, 188, 121)"), "#0dbc79");
    assert.equal(cssColorToXterm("rgb(13 188 121 / 50%)"), "rgba(13, 188, 121, 0.5)");
    assert.equal(cssColorToXterm("rgba(0, 0, 0, 0.25)"), "rgba(0, 0, 0, 0.25)");
    assert.equal(cssColorToXterm("#00000080"), "rgba(0, 0, 0, 0.502)");
  });

  it("converts oklch / oklab to sRGB", () => {
    // oklch white / black and a known mid color (sRGB #cd3131 = oklch(0.5592 0.1927 26.08)).
    assert.equal(cssColorToXterm("oklch(1 0 0)"), "#ffffff");
    assert.equal(cssColorToXterm("oklch(0 0 0)"), "#000000");
    const red = parseCssColor("oklch(0.5592 0.1927 26.08)");
    assert.ok(red);
    assert.ok(Math.abs(red.r - 0xcd) <= 2 && Math.abs(red.g - 0x31) <= 2 && Math.abs(red.b - 0x31) <= 2, JSON.stringify(red));
    assert.equal(cssColorToXterm("oklch(100% 0 none / 0.24)"), "rgba(255, 255, 255, 0.24)");
    assert.equal(cssColorToXterm("oklab(1 0 0)"), "#ffffff");
  });

  it("converts color(srgb | srgb-linear | display-p3)", () => {
    assert.equal(cssColorToXterm("color(srgb 1 0 0)"), "#ff0000");
    assert.equal(cssColorToXterm("color(srgb-linear 1 1 1 / 0.5)"), "rgba(255, 255, 255, 0.5)");
    // P3 pure red is outside sRGB: clamps to red.
    assert.equal(cssColorToXterm("color(display-p3 1 0 0)"), "#ff0000");
  });

  it("rejects what it cannot convert", () => {
    for (const input of ["", "red", "var(--x)", "color-mix(in oklch, red, blue)", "lab(50 20 10)", "#12", "rgb(1, 2)"]) {
      assert.equal(cssColorToXterm(input), undefined, input);
    }
    assert.deepEqual(parseCssColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  });

  it("formats alpha with at most three decimals", () => {
    assert.equal(formatXtermColor({ r: 1, g: 2, b: 3, a: 1 / 3 }), "rgba(1, 2, 3, 0.333)");
    assert.equal(formatXtermColor({ r: 255, g: 0, b: 16, a: 1 }), "#ff0010");
  });
});
