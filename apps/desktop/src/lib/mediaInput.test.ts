import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  agentSupportsImageInput,
  buildPromptBlocks,
  imageUnsupportedMessage,
} from "./mediaInput.js";

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

  it("detects image capability from agentCapabilities (real path, not hardcoded false)", () => {
    assert.equal(
      agentSupportsImageInput({ promptCapabilities: { image: false } }),
      false,
    );
    assert.equal(
      agentSupportsImageInput({ promptCapabilities: { image: true } }),
      true,
    );
    assert.equal(agentSupportsImageInput(undefined), false);
  });

  it("provides non-silent degradation copy", () => {
    assert.match(imageUnsupportedMessage(), /will not be sent/i);
  });
});

