import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentSupportsImageInput,
  attachmentPreviewSrc,
  buildPromptBlocks,
  canInlinePreviewAttachment,
  imageUnsupportedMessage,
  isBrowserPreviewableImage,
} from "@/lib/mediaInput";

describe("mediaInput", () => {
  it("builds text + image content blocks", () => {
    const blocks = buildPromptBlocks("hi", [
      { mimeType: "image/png", data: "abc" },
    ]);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]?.type, "text");
    assert.equal(blocks[1]?.type, "image");
    assert.equal(
      (blocks[1] as { type: string; data: string }).data,
      "abc",
    );
  });

  it("builds image-only blocks when text empty", () => {
    const blocks = buildPromptBlocks("", [
      { mimeType: "image/png", data: "xyz" },
    ]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]?.type, "image");
  });

  it("enables image UI for grok-build even when promptCapabilities.image is false", () => {
    // Live CLI still advertises image:false but accepts image ContentBlocks.
    assert.equal(
      agentSupportsImageInput({
        loadSession: true,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
      }),
      true,
    );
    assert.equal(
      agentSupportsImageInput({ promptCapabilities: { image: true } }),
      true,
    );
    // Pre-handshake: product is live-only — allow attach.
    assert.equal(agentSupportsImageInput(undefined), true);
    // Non-grok agent that never claims image stays gated.
    assert.equal(
      agentSupportsImageInput({ promptCapabilities: { image: false } }),
      false,
    );
  });

  it("provides non-silent degradation copy", () => {
    assert.match(imageUnsupportedMessage(), /will not be sent/i);
  });

  it("classifies browser-previewable image mimes for the attach strip", () => {
    assert.equal(isBrowserPreviewableImage("image/png"), true);
    assert.equal(isBrowserPreviewableImage("image/jpeg"), true);
    assert.equal(isBrowserPreviewableImage("image/webp;charset=utf-8"), true);
    // HEIC/TIFF need system Preview — not inline <img>.
    assert.equal(isBrowserPreviewableImage("image/heic"), false);
    assert.equal(isBrowserPreviewableImage("image/tiff"), false);
  });

  it("builds data-URL thumbs only when payload exists", () => {
    assert.equal(
      attachmentPreviewSrc({ mimeType: "image/png", data: "abc" }),
      "data:image/png;base64,abc",
    );
    assert.equal(
      attachmentPreviewSrc({ mimeType: "image/png", data: "" }),
      "",
    );
    assert.equal(
      canInlinePreviewAttachment({ mimeType: "image/png", data: "abc" }),
      true,
    );
    assert.equal(
      canInlinePreviewAttachment({ mimeType: "image/heic", data: "abc" }),
      false,
    );
    assert.equal(
      canInlinePreviewAttachment({ mimeType: "image/png", data: "" }),
      false,
    );
  });
});

