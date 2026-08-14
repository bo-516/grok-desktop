/**
 * Palette row markup: kind badge + overflow cells reprint the GitHub pretext.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { GITHUB_OVERFLOW_PRETEXT } from "@/lib/overflowText";
import type { PaletteItem } from "@/lib/commandPalette";
import { CommandPaletteItemView } from "@/widgets/CommandPaletteItemView";

describe("CommandPaletteItemView", () => {
  it("prints kind / label / GitHub pretext description", () => {
    const item: PaletteItem = {
      id: "mcp:browser-use",
      kind: "mcp",
      label: "browser-use",
      description: GITHUB_OVERFLOW_PRETEXT,
      runValue: "browser-use",
    };
    const html = renderToStaticMarkup(
      createElement(CommandPaletteItemView, {
        item,
        active: true,
        onHover: () => undefined,
        onRun: () => undefined,
      }),
    );
    assert.match(html, /palette-kind/);
    assert.match(html, />mcp</);
    assert.match(html, /browser-use/);
    assert.match(html, /github\.com\/bo-516\/grok-desktop/);
    assert.match(html, /palette-item-active/);
  });
});
