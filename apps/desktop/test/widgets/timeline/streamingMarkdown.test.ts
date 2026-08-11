/**
 * Contract tests: agent bubble markdown is rendered via Streamdown (not a custom parser).
 * Math uses the official @streamdown/math plugin (KaTeX) — not a bespoke pipeline.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(here, "../../../src/widgets/timeline/StreamingMarkdownView.tsx"),
  "utf8",
);

describe("StreamingMarkdownView (Streamdown)", () => {
  it("renders with Streamdown and GFM-friendly streaming props", () => {
    assert.match(viewSource, /from ["']streamdown["']/);
    assert.match(viewSource, /<Streamdown[\s\S]*parseIncompleteMarkdown/);
    assert.match(viewSource, /mode=\{showCursor \? "streaming" : "static"\}/);
    assert.match(viewSource, /controls=\{false\}/);
  });

  it("maps tables and core blocks to md-* classes (no self-hosted parser)", () => {
    assert.match(viewSource, /md-table/);
    assert.match(viewSource, /md-inline-code/);
    assert.match(viewSource, /md-list/);
    assert.doesNotMatch(viewSource, /parseStreamingMarkdown/);
  });

  it("enables KaTeX math via @streamdown/math (inline + display delimiters)", () => {
    assert.match(viewSource, /from ["']@streamdown\/math["']/);
    assert.match(viewSource, /createMathPlugin/);
    assert.match(viewSource, /singleDollarTextMath:\s*true/);
    assert.match(viewSource, /errorColor:\s*["']var\(--color-danger\)["']/);
    assert.match(viewSource, /plugins=\{streamdownPlugins\}/);
    assert.match(viewSource, /katex\/dist\/katex\.min\.css/);
  });

  it("normalizes bare agent () / [] TeX wrappers before Streamdown", () => {
    assert.match(viewSource, /from ["']@\/lib\/normalizeAgentMath["']/);
    assert.match(viewSource, /normalizeAgentMath\(text\)/);
  });
});
