/**
 * hasMathDelimiters: KaTeX chunk gate — must be a superset of remark-math.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasMathDelimiters } from "@/lib/mathDelimiters";
import { normalizeAgentMath } from "@/lib/normalizeAgentMath";

/** Agent flavour (singleDollarTextMath: true). */
const AGENT = { singleDollar: true };
/** Document flavour (singleDollarTextMath: false). */
const DOC = { singleDollar: false };

describe("hasMathDelimiters (agent flavour)", () => {
  it("is false for text without any dollar sign", () => {
    assert.equal(hasMathDelimiters("Plain answer with `code`.", AGENT), false);
    assert.equal(hasMathDelimiters("", AGENT), false);
  });

  it("is true for inline $…$ and display $$ fences", () => {
    assert.equal(hasMathDelimiters("Area is $\\pi r^2$.", AGENT), true);
    assert.equal(hasMathDelimiters("$$\nx^2\n$$", AGENT), true);
    assert.equal(hasMathDelimiters("Inline $$x$$ too", AGENT), true);
  });

  it("is false for a single stray dollar (cannot open and close math)", () => {
    assert.equal(hasMathDelimiters("It costs $5.", AGENT), false);
  });

  it("ignores dollars inside fenced code and inline code spans", () => {
    const shell = "Run:\n```bash\n$ npm install\n$ npm test\n```\nDone.";
    assert.equal(hasMathDelimiters(shell, AGENT), false);
    const tilde = "~~~sh\necho $HOME $PATH\n~~~";
    assert.equal(hasMathDelimiters(tilde, AGENT), false);
    assert.equal(
      hasMathDelimiters("Set `$PATH` and `$HOME` first.", AGENT),
      false,
    );
  });

  it("treats an unclosed fence as code to the end (mid-stream)", () => {
    assert.equal(hasMathDelimiters("```sh\n$ ls\n$ pwd", AGENT), false);
  });

  it("still sees math next to code", () => {
    const mixed = "```sh\n$ ls\n```\nThen $a+b$ holds.";
    assert.equal(hasMathDelimiters(mixed, AGENT), true);
  });

  it("detects agent backslash math once normalized to dollars", () => {
    const raw = "Solve \\(x^{2} = 4\\).";
    assert.equal(hasMathDelimiters(raw, AGENT), false);
    assert.equal(hasMathDelimiters(normalizeAgentMath(raw), AGENT), true);
  });
});

describe("hasMathDelimiters (doc flavour)", () => {
  it("requires $$ — single-dollar pairs are currency / shell, not math", () => {
    assert.equal(hasMathDelimiters("From $5 to $10.", DOC), false);
    assert.equal(hasMathDelimiters("$$\n\\int f\n$$", DOC), true);
  });

  it("ignores $$ inside code", () => {
    assert.equal(hasMathDelimiters("```sh\necho $$\n```", DOC), false);
    assert.equal(hasMathDelimiters("PID is `$$`.", DOC), false);
  });
});
