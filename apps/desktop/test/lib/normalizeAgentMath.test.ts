/**
 * Unit tests for agent LaTeX wrapper normalization.
 * remark-math v6 only accepts $ / $$ — normalizer must emit those, never \( \)/\[ \].
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeLatex,
  normalizeAgentMath,
} from "@/lib/normalizeAgentMath";

describe("looksLikeLatex", () => {
  it("accepts TeX control words and braced super/subscripts", () => {
    assert.equal(looksLikeLatex("\\sqrt{r^{2}-h^{2}}"), true);
    assert.equal(looksLikeLatex("\\pi r^{2}"), true);
    assert.equal(looksLikeLatex("S_{\\text{球}} = \\pi(r^{2}-h^{2})"), true);
    assert.equal(looksLikeLatex("x^{2}+1"), true);
  });

  it("rejects plain prose / single variables in parens", () => {
    assert.equal(looksLikeLatex("h"), false);
    assert.equal(looksLikeLatex("推荐"), false);
    assert.equal(looksLikeLatex("hello world"), false);
    assert.equal(looksLikeLatex(""), false);
  });
});

describe("normalizeAgentMath", () => {
  it("returns plain text unchanged when no TeX tokens exist", () => {
    assert.equal(normalizeAgentMath("hello (world)"), "hello (world)");
    assert.equal(normalizeAgentMath(""), "");
  });

  it("wraps bare parenthetical TeX as $…$ inline math", () => {
    const out = normalizeAgentMath(
      "半径为 (\\sqrt{r^{2}-h^{2}}) 的圆，面积 (\\pi r^{2})",
    );
    assert.match(out, /\$\\sqrt\{r\^\{2\}-h\^\{2\}\}\$/);
    assert.match(out, /\$\\pi r\^\{2\}\$/);
    // Must NOT emit \( \) — remark-math v6 ignores them and CommonMark eats the backslash.
    assert.doesNotMatch(out, /\\\(/);
    // Plain (h) stays text.
    assert.equal(normalizeAgentMath("高度 (h) 处"), "高度 (h) 处");
  });

  it("converts multi-line [ … ] blocks with TeX into $$ display math", () => {
    const src = [
      "由祖暅原理：",
      "[",
      "V_{\\text{半球}} = V_{\\text{圆柱}} - V_{\\text{圆锥}}",
      "]",
      "结束",
    ].join("\n");
    const out = normalizeAgentMath(src);
    // A fence block, not $$…$$ on one line: only `$$` alone on a line opens
    // flow math, which is what rehype-katex renders with displayMode.
    assert.equal(
      out,
      [
        "由祖暅原理：",
        "$$",
        "V_{\\text{半球}} = V_{\\text{圆柱}} - V_{\\text{圆锥}}",
        "$$",
        "结束",
      ].join("\n"),
    );
    assert.doesNotMatch(out, /\\\[/);
  });

  it("converts same-line [ TeX ] that is not a Markdown link", () => {
    const out = normalizeAgentMath(
      "剩余： [ S_{\\text{柱-锥}} = \\pi r^{2} - \\pi h^{2} ] 完成",
    );
    assert.match(
      out,
      /\$\$S_\{\\text\{柱-锥\}\} = \\pi r\^\{2\} - \\pi h\^\{2\}\$\$/,
    );
    // Real links stay.
    assert.equal(
      normalizeAgentMath("see [docs](https://example.com)"),
      "see [docs](https://example.com)",
    );
  });

  it("rewrites \\( \\) / \\[ \\] into $ / $$ so remark-math can parse them", () => {
    const paren = normalizeAgentMath("面积 \\(S = \\pi r^{2}\\) 完成");
    assert.match(paren, /\$S = \\pi r\^\{2\}\$/);
    assert.doesNotMatch(paren, /\\\(/);

    const bracket = normalizeAgentMath("\\[\nS = \\pi r^{2}\n\\]");
    assert.equal(bracket, "$$\nS = \\pi r^{2}\n$$");
    assert.doesNotMatch(bracket, /\\\[/);

    // A one-line \[ … \] is still a display equation, so it still gets a fence.
    assert.equal(
      normalizeAgentMath("\\[ S = \\pi r^{2} \\]"),
      "$$\nS = \\pi r^{2}\n$$",
    );
  });

  it("keeps a display fence inside the list item it was written in", () => {
    // Regression: the closing fence used to be re-emitted at column 0, dropping
    // out of the list item. remark-math then read it as a *new* opener and
    // swallowed every following block into one formula.
    const src = [
      "- 结论直觉：  ",
      "  \\[",
      "  S \\approx 4 \\times \\pi r^{2} = 4\\pi r^{2}",
      "  \\]",
      "",
      "### 2. 与圆柱的关系",
    ].join("\n");
    const out = normalizeAgentMath(src);
    assert.equal(
      out,
      [
        "- 结论直觉：  ",
        "  $$",
        "  S \\approx 4 \\times \\pi r^{2} = 4\\pi r^{2}",
        "  $$",
        "",
        "### 2. 与圆柱的关系",
      ].join("\n"),
    );
  });

  it("never leaves a blank line inside an emitted fence", () => {
    // A blank line ends the list item; the closer would be orphaned again.
    const out = normalizeAgentMath("  \\[\n  A = B\n  \n  \\]");
    assert.equal(out, "  $$\n  A = B\n  $$");
  });

  it("neutralizes an unpaired $$ fence so it cannot swallow the answer", () => {
    const src = [
      "开头",
      "$$",
      "S = \\pi r^{2}",
      "$$",
      "",
      "$$",
      "",
      "### 后续小节",
      "",
      "正文继续。",
    ].join("\n");
    const out = normalizeAgentMath(src);
    // The stray opener becomes a literal `$$`; the balanced pair is untouched.
    assert.equal(out.split("\n")[5], "\\$\\$");
    assert.match(out, /^\$\$\nS = \\pi r\^\{2\}\n\$\$$/m);
    assert.match(out, /### 后续小节/);
  });

  it("closes a fence still open at the end of a stream tick", () => {
    const out = normalizeAgentMath("于是\n$$\nS = \\frac{4}{3}\\pi r^{3}");
    assert.equal(out, "于是\n$$\nS = \\frac{4}{3}\\pi r^{3}\n$$");
  });

  it("does not rewrite fenced code or already-correct dollar math", () => {
    const fenced = ["```ts", "const x = (\\pi)", "```"].join("\n");
    assert.equal(normalizeAgentMath(fenced), fenced);

    const dollars = "面积 $S = \\pi r^{2}$ 与 $$V = \\frac{4}{3}\\pi r^{3}$$";
    assert.equal(normalizeAgentMath(dollars), dollars);
  });

  it("handles the sphere-volume textbook shape from agent screenshots", () => {
    const src = [
      "半球截面：半径为 (\\sqrt{r^{2}-h^{2}}) 的圆,",
      "",
      "[",
      "S_{\\text{球}} = \\pi(r^{2}-h^{2})",
      "]",
      "",
      "因此整球：",
      "[",
      "V_{\\text{球}} = 2 \\times \\frac{2}{3}\\pi r^{3} = \\frac{4}{3}\\pi r^{3}",
      "]",
    ].join("\n");
    const out = normalizeAgentMath(src);
    assert.match(out, /\$\\sqrt\{r\^\{2\}-h\^\{2\}\}\$/);
    assert.match(out, /^\$\$\nS_\{\\text\{球\}\} = \\pi\(r\^\{2\}-h\^\{2\}\)\n\$\$$/m);
    assert.match(
      out,
      /^\$\$\nV_\{\\text\{球\}\} = 2 \\times \\frac\{2\}\{3\}\\pi r\^\{3\} = \\frac\{4\}\{3\}\\pi r\^\{3\}\n\$\$$/m,
    );
    assert.doesNotMatch(out, /\\\(|\\\[/);
  });

  it("leaves every display block of a real agent answer paired", () => {
    // The screenshot regression in full: \( \) inline, \[ \] blocks at column 0
    // and indented inside a list, an aligned environment, and a GFM table.
    const src = [
      "## 一、球的表面积 \\(S = 4\\pi r^{2}\\)",
      "",
      "- 结论直觉：  ",
      "  \\[",
      "  S \\approx 4 \\times \\pi r^{2} = 4\\pi r^{2}",
      "  \\]",
      "",
      "### 2. 与圆柱的关系",
      "",
      "圆柱侧面积：",
      "\\[",
      "2\\pi r \\cdot 2r = 4\\pi r^{2}",
      "\\]",
      "",
      "| 已知 | 推导另一式 |",
      "|------|------------|",
      "| \\(V=\\dfrac{4}{3}\\pi r^{3}\\) | \\(S=4\\pi r^{2}\\) |",
      "",
      "\\[",
      "\\begin{aligned}",
      "S &= 4\\pi r^{2} \\\\",
      "V &= \\frac{4}{3}\\pi r^{3}",
      "\\end{aligned}",
      "\\]",
    ].join("\n");
    const out = normalizeAgentMath(src);

    assert.doesNotMatch(out, /\\\(|\\\[/);
    // Fence lines come in pairs — an odd count is the runaway bug.
    const fences = out.split("\n").filter((line) => /^[ \t]*\$\$[ \t]*$/.test(line));
    assert.equal(fences.length % 2, 0);
    // Three display blocks: the list item, 圆柱侧面积, and the aligned environment.
    assert.equal(fences.length, 6);
    // Headings, list markers and table rows stay outside math.
    assert.match(out, /^## 一、球的表面积 \$S = 4\\pi r\^\{2\}\$$/m);
    assert.match(out, /^\| 已知 \| 推导另一式 \|$/m);
    // Row separators (\\) survive: they are inside math, not CommonMark escapes.
    assert.match(out, /^S &= 4\\pi r\^\{2\} \\\\$/m);
  });
});
