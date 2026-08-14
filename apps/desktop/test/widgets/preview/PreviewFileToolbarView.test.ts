/**
 * Preview file toolbar copy flash: idle stays icon-only; copied shows check + label.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { PreviewFileToolbarView } from "@/widgets/preview/PreviewFileToolbarView";
import { readDesktopRoot } from "../../helpers/sourceFiles";

/**
 * Render the toolbar with a no-op mode handler so markup stays the only output.
 * @param copied Whether the copy flash is active.
 * @returns Static HTML for the copy control.
 */
function renderToolbar(copied: boolean): string {
  return renderToStaticMarkup(
    createElement(PreviewFileToolbarView, {
      showModeToggle: false,
      mode: "source",
      onModeChange: () => undefined,
      onCopy: () => undefined,
      copied,
    }),
  );
}

describe("PreviewFileToolbarView copy feedback", () => {
  it("idle copy control is icon-only with the copy label", () => {
    const html = renderToolbar(false);
    assert.match(html, /preview-copy-btn/);
    assert.doesNotMatch(html, /class="[^"]*btn-ghost/);
    assert.match(html, /aria-label="Copy full text"/);
    assert.match(html, /title="Copy full text"/);
    assert.doesNotMatch(html, />Copied</);
  });

  it("copied flash swaps the label and paints Copied next to the check", () => {
    const html = renderToolbar(true);
    assert.match(html, /preview-copy-btn/);
    assert.match(html, /aria-label="Copied"/);
    assert.match(html, /title="Copied"/);
    assert.match(html, />Copied</);
  });

  it("copy and close share a 24px flex-centered face", () => {
    const preview = readDesktopRoot("uno/shortcuts.preview.ts");
    const copy = preview.match(/"preview-copy-btn":\s*"([^"]+)"/);
    assert.ok(copy?.[1], "preview-copy-btn shortcut present");
    assert.match(copy[1], /inline-flex/);
    assert.match(copy[1], /items-center/);
    assert.match(copy[1], /justify-center/);
    assert.match(copy[1], /h-24px/);
    assert.doesNotMatch(copy[1], /btn-ghost/);
    const chrome = readDesktopRoot("uno/shortcuts.chrome.ts");
    const close = chrome.match(/"context-drawer-close":\s*"([^"]+)"/);
    assert.ok(close?.[1], "context-drawer-close shortcut present");
    assert.match(close[1], /inline-flex/);
    assert.match(close[1], /w-24px/);
    assert.match(close[1], /h-24px/);
  });
});
