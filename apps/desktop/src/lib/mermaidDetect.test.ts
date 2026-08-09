import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractMermaidBlocks, hasMermaid } from "./mermaidDetect.js";

describe("mermaidDetect", () => {
  it("extracts mermaid fences", () => {
    const blocks = extractMermaidBlocks("x\n```mermaid\ngraph TD;A-->B\n```\ny");
    assert.equal(blocks.length, 1);
    assert.match(blocks[0]!, /graph TD/);
    assert.equal(hasMermaid("no"), false);
  });
});
