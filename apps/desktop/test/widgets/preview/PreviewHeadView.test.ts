/**
 * Preview head path copy: no inline flag; flash chip sits at the pointer.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { CopiedCursorFlashView } from "@/widgets/preview/CopiedCursorFlashView";
import { PreviewHeadView } from "@/widgets/preview/PreviewHeadView";

/** Shared path parts so copy-flash tests do not invent a second fixture. */
const DISPLAY = {
  full: "/Users/me/project/src/foo.ts",
  dir: "src",
  base: "foo.ts",
  label: "src/foo.ts",
  inWorkspace: true,
};

describe("PreviewHeadView path copy flash", () => {
  it("idle path title has no Copied mark", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewHeadView, {
        title: DISPLAY.full,
        display: DISPLAY,
        onClose: () => undefined,
      }),
    );
    assert.match(html, /foo\.ts/);
    assert.match(html, /path-label-wrap/);
    assert.match(html, /path-label-base-wrap/);
    assert.doesNotMatch(html, />Copied</);
    assert.doesNotMatch(html, /preview-copy-flash/);
  });

  it("copied + copyAt paints the same Copied mark as the toolbar button", () => {
    const html = renderToStaticMarkup(
      createElement(PreviewHeadView, {
        title: DISPLAY.full,
        display: DISPLAY,
        copied: true,
        copyAt: { x: 120, y: 40 },
        onClose: () => undefined,
      }),
    );
    assert.match(html, />Copied</);
    assert.match(html, /preview-copy-flash/);
    assert.doesNotMatch(html, /preview-copy-btn/);
  });
});

describe("CopiedCursorFlashView", () => {
  it("parks the chip below the pointer, centered on clientX", () => {
    const html = renderToStaticMarkup(
      createElement(CopiedCursorFlashView, { x: 200, y: 50 }),
    );
    // 50 + 12px offset (COPY_FLASH_OFFSET_Y).
    assert.match(html, /left:200px/);
    assert.match(html, /top:62px/);
    assert.match(html, />Copied</);
  });
});
