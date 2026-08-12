/**
 * Token × emph-range split: join preserves source line text.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeToken } from "@/lib/codeHighlight";
import { splitTokensByRanges } from "@/lib/diffTokenSplit";
import type { EmphRange } from "@/lib/diffWordRanges";

/** Build sequential plain tokens covering `text` from file offset `base`. */
function tokensFor(text: string, base = 0, chunk = 3): CodeToken[] {
  const out: CodeToken[] = [];
  for (let i = 0; i < text.length; i += chunk) {
    out.push({
      content: text.slice(i, i + chunk),
      kind: "plain",
      offset: base + i,
    });
  }
  return out;
}

describe("diffTokenSplit", () => {
  it("join of split contents equals source line", () => {
    const text = "const value = 42;";
    const tokens = tokensFor(text, 100);
    const ranges: EmphRange[] = [{ start: 6, end: 11 }];
    const split = splitTokensByRanges(tokens, ranges, 100);
    assert.equal(split.map((t) => t.content).join(""), text);
  });

  it("property: random ranges still join to source (200 samples)", () => {
    const samples = [
      "hello world",
      "const a = 1",
      "fn(x, y) { return x + y; }",
      "a",
      "αβγ",
      "  spaced  tabs\t",
    ];
    for (let n = 0; n < 200; n += 1) {
      const text = samples[n % samples.length]!;
      const base = (n * 17) % 500;
      const tokens = tokensFor(text, base, 1 + (n % 5));
      const ranges: EmphRange[] = [];
      if (text.length > 0) {
        const a = n % text.length;
        const b = a + 1 + (n % Math.max(1, text.length - a));
        ranges.push({ start: a, end: Math.min(text.length, b) });
        if (n % 3 === 0 && text.length > 4) {
          ranges.push({ start: 0, end: 2 });
        }
      }
      const split = splitTokensByRanges(tokens, ranges, base);
      assert.equal(
        split.map((t) => t.content).join(""),
        text,
        `sample ${n} failed for ${JSON.stringify(text)}`,
      );
    }
  });

  it("range across token boundary splits both tokens", () => {
    const text = "abcdef";
    // tokens: "abc" | "def" at base 0
    const tokens = tokensFor(text, 0, 3);
    const ranges: EmphRange[] = [{ start: 2, end: 5 }]; // cde
    const split = splitTokensByRanges(tokens, ranges, 0);
    assert.equal(split.map((t) => t.content).join(""), text);
    const emph = split.filter((t) => t.emph).map((t) => t.content).join("");
    assert.equal(emph, "cde");
  });

  it("empty token array returns empty", () => {
    assert.deepEqual(splitTokensByRanges([], [{ start: 0, end: 1 }], 0), []);
    assert.deepEqual(splitTokensByRanges(undefined, [{ start: 0, end: 1 }], 0), []);
  });

  it("no ranges marks nothing emph", () => {
    const tokens = tokensFor("abc", 0, 1);
    const split = splitTokensByRanges(tokens, [], 0);
    assert.ok(split.every((t) => !t.emph));
  });
});
