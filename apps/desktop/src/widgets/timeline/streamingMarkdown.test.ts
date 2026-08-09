/**
 * Streaming Markdown parse unit tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseInline,
  parseStreamingMarkdown,
  safeHttpUrl,
} from "./streamingMarkdown";

describe("safeHttpUrl", () => {
  it("allows http(s) only", () => {
    assert.equal(safeHttpUrl("https://x.ai"), "https://x.ai");
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
  });
});

describe("parseInline", () => {
  it("parses bold and code", () => {
    const nodes = parseInline("hi **bold** and `code`");
    assert.equal(nodes.some((n) => n.type === "strong"), true);
    assert.equal(nodes.some((n) => n.type === "code"), true);
  });
});

describe("parseStreamingMarkdown", () => {
  it("keeps open fence while streaming", () => {
    const blocks = parseStreamingMarkdown("```ts\nconst x = 1");
    const fence = blocks.find((b) => b.type === "code_block");
    assert.ok(fence && fence.type === "code_block");
    assert.equal(fence.closed, false);
    assert.match(fence.text, /const x/);
  });

  it("closes fence and parses list", () => {
    const blocks = parseStreamingMarkdown(
      "```\nok\n```\n\n- a\n- b\n\nDone **now**",
    );
    assert.ok(blocks.some((b) => b.type === "code_block" && b.closed));
    assert.ok(blocks.some((b) => b.type === "list" && !b.ordered));
    assert.ok(blocks.some((b) => b.type === "paragraph"));
  });
});
