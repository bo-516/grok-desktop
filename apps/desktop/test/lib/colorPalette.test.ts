import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COLOR_PALETTE_OPTIONS,
  isPaletteOptionActive,
  type ColorPaletteOption,
} from "@/lib/colorPalette";

describe("colorPalette", () => {
  it("ships black, white, and the eight accent swatches", () => {
    assert.equal(COLOR_PALETTE_OPTIONS.length, 10);
    const labels = COLOR_PALETTE_OPTIONS.map((o) => o.label);
    assert.deepEqual(labels, [
      "Black",
      "White",
      "Blue",
      "Purple",
      "Pink",
      "Red",
      "Orange",
      "Yellow",
      "Green",
      "Gray",
    ]);
  });

  it("treats black/white as mono + forced theme", () => {
    const black = COLOR_PALETTE_OPTIONS[0] as ColorPaletteOption;
    const white = COLOR_PALETTE_OPTIONS[1] as ColorPaletteOption;
    const blue = COLOR_PALETTE_OPTIONS[2] as ColorPaletteOption;
    assert.equal(black.forceTheme, "dark");
    assert.equal(white.forceTheme, "light");
    assert.equal(blue.forceTheme, undefined);
    assert.equal(isPaletteOptionActive(black, "mono", "dark"), true);
    assert.equal(isPaletteOptionActive(black, "mono", "light"), false);
    assert.equal(isPaletteOptionActive(white, "mono", "light"), true);
    assert.equal(isPaletteOptionActive(blue, "blue", "dark"), true);
    assert.equal(isPaletteOptionActive(blue, "mono", "dark"), false);
  });
});
