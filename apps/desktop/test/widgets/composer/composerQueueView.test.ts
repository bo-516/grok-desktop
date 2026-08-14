/**
 * Queued follow-up strip: 1-based index, text, Send now / Edit / Cancel.
 */

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { ComposerQueueView } from "@/widgets/composer/ComposerQueueView";

describe("ComposerQueueView", () => {
  it("renders nothing when the canvas queue is empty", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerQueueView, {
        items: [],
        onSendNow: () => undefined,
        onEdit: () => undefined,
        onCancel: () => undefined,
      }),
    );
    assert.equal(html, "");
  });

  it("renders each follow-up with a 1-based index and the three grok-build actions", () => {
    const html = renderToStaticMarkup(
      createElement(ComposerQueueView, {
        items: [
          { id: "q1", sessionId: "s1", text: "first follow-up" },
          { id: "q2", sessionId: "s1", text: "second follow-up" },
        ],
        onSendNow: () => undefined,
        onEdit: () => undefined,
        onCancel: () => undefined,
      }),
    );
    assert.match(html, /first follow-up/);
    assert.match(html, /second follow-up/);
    assert.match(html, /aria-label="Queued follow-ups"/);
    assert.match(html, /aria-label="Queued follow-up 1"/);
    assert.match(html, /aria-label="Queued follow-up 2"/);
    assert.match(html, /aria-posinset="1"/);
    assert.match(html, /aria-posinset="2"/);
    assert.match(html, /aria-setsize="2"/);
    assert.match(html, /composer-queue-row group/);
    assert.equal(html.split("composer-queue-index").length - 1, 2);
    assert.equal(html.split('aria-label="Send now"').length - 1, 2);
    assert.equal(html.split('aria-label="Edit"').length - 1, 2);
    assert.equal(html.split('aria-label="Cancel"').length - 1, 2);
  });
});
