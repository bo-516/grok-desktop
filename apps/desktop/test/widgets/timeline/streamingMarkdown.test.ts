/**
 * Contract tests: agent bubble markdown is rendered via Streamdown (not a custom parser).
 * Math uses the official @streamdown/math plugin (KaTeX) — not a bespoke pipeline —
 * and KaTeX is code-split behind hasMathDelimiters + a lazy Streamdown variant.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSrc } from "../../helpers/sourceFiles";

const viewSource = readSrc("widgets/timeline/StreamingMarkdownView.tsx");
const mathViewSource = readSrc("widgets/shared/MathStreamdownView.tsx");
const lazyMathSource = readSrc("widgets/shared/lazyMathStreamdown.ts");
const sharedIndexSource = readSrc("widgets/shared/index.ts");
const docWidgetSource = readSrc("widgets/preview/PreviewDocWidget.tsx");

describe("StreamingMarkdownView (Streamdown)", () => {
  it("renders with Streamdown and GFM-friendly streaming props", () => {
    assert.match(viewSource, /from ["']streamdown["']/);
    assert.match(viewSource, /<Streamdown \{\.\.\.markdownProps\}>/);
    assert.match(viewSource, /parseIncompleteMarkdown: true/);
    assert.match(viewSource, /mode: showCursor \? "streaming" : "static"/);
    assert.match(viewSource, /controls: false/);
  });

  it("maps tables and core blocks to md-* classes (no self-hosted parser)", () => {
    assert.match(viewSource, /md-table/);
    assert.match(viewSource, /md-inline-code/);
    assert.match(viewSource, /md-list/);
    assert.doesNotMatch(viewSource, /parseStreamingMarkdown/);
  });

  it("enables KaTeX math via @streamdown/math (inline + display delimiters)", () => {
    assert.match(mathViewSource, /from ["']@streamdown\/math["']/);
    assert.match(mathViewSource, /createMathPlugin/);
    assert.match(mathViewSource, /singleDollarTextMath:\s*true/);
    assert.match(mathViewSource, /errorColor:\s*["']var\(--color-danger\)["']/);
    assert.match(mathViewSource, /katex\/dist\/katex\.min\.css/);
    assert.match(viewSource, /mathVariant="agent"/);
  });

  it("loads KaTeX lazily, only when the text may contain math", () => {
    // Startup graph must not import KaTeX or its CSS statically.
    assert.doesNotMatch(viewSource, /from ["']@streamdown\/math["']|import ["']katex/);
    assert.match(viewSource, /hasMathDelimiters\(mathReady, \{ singleDollar: true \}\)/);
    assert.match(viewSource, /<Suspense fallback=\{plain\}>/);
    assert.match(lazyMathSource, /lazy\(/);
    assert.match(lazyMathSource, /import\("\.\/MathStreamdownView"\)/);
    // The barrel only re-exports the lazy entry; MathStreamdownView is type-only.
    assert.doesNotMatch(
      sharedIndexSource,
      /export \{[^}]*\bMathStreamdownView\b[^}]*\} from "\.\/MathStreamdownView"/,
    );
  });

  it("normalizes bare agent () / [] TeX wrappers before Streamdown", () => {
    assert.match(viewSource, /from ["']@\/lib\/normalizeAgentMath["']/);
    assert.match(viewSource, /normalizeAgentMath\(text\)/);
  });
});

describe("PreviewDocWidget math (lazy KaTeX, doc flavour)", () => {
  it("uses the doc variant ($$ only) behind the same lazy gate", () => {
    assert.doesNotMatch(
      docWidgetSource,
      /from ["']@streamdown\/math["']|import ["']katex/,
    );
    assert.match(docWidgetSource, /hasMathDelimiters\(content, \{ singleDollar: false \}\)/);
    assert.match(docWidgetSource, /mathVariant="doc"/);
    assert.match(mathViewSource, /singleDollarTextMath:\s*false/);
  });
});
