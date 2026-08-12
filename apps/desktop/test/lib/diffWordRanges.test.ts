/**
 * Word-level emph range gates and pairing rules (doc §5.2 / §7).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORD_EMPH_MAX_LINE_CHARS,
  WORD_EMPH_MIN_SIMILARITY,
  wordRangesForRun,
} from "@/lib/diffWordRanges";

describe("diffWordRanges", () => {
  it("const a = 1 → const b = 1 only marks a / b", () => {
    const { del, add } = wordRangesForRun(["const a = 1"], ["const b = 1"]);
    assert.equal(del.length, 1);
    assert.equal(add.length, 1);
    assert.ok(del[0]!.length >= 1);
    assert.ok(add[0]!.length >= 1);
    const delText = "const a = 1";
    const addText = "const b = 1";
    const delMarked = del[0]!.map((r) => delText.slice(r.start, r.end)).join("");
    const addMarked = add[0]!.map((r) => addText.slice(r.start, r.end)).join("");
    assert.equal(delMarked, "a");
    assert.equal(addMarked, "b");
  });

  it("unequal del/add counts return all empty ranges (structural gate)", () => {
    const { del, add } = wordRangesForRun(
      ["one", "two", "three", "four", "five"],
      Array.from({ length: 20 }, (_, i) => `add-${i}`),
    );
    assert.equal(del.length, 5);
    assert.equal(add.length, 20);
    for (const ranges of del) {
      assert.deepEqual(ranges, []);
    }
    for (const ranges of add) {
      assert.deepEqual(ranges, []);
    }
  });

  it("low similarity equal-length pair yields empty ranges", () => {
    // Completely unrelated lines of equal count — common non-ws ratio ~0.
    const { del, add } = wordRangesForRun(
      ["aaaaaaaaaaaaaaaaaaaa"],
      ["bbbbbbbbbbbbbbbbbbbb"],
    );
    assert.deepEqual(del[0], []);
    assert.deepEqual(add[0], []);
    assert.ok(WORD_EMPH_MIN_SIMILARITY === 0.4);
  });

  it("whitespace-only common does not count toward similarity", () => {
    // Shared spaces/`*` only — should not produce word emph.
    const { del, add } = wordRangesForRun(
      ["*   totally different alpha"],
      ["*   completely other omega"],
    );
    assert.deepEqual(del[0], []);
    assert.deepEqual(add[0], []);
  });

  it("single-word replace still produces ranges", () => {
    const { del, add } = wordRangesForRun(["const a"], ["const b"]);
    assert.ok(del[0]!.length >= 1);
    assert.ok(add[0]!.length >= 1);
    assert.equal("const a".slice(del[0]![0]!.start, del[0]![0]!.end), "a");
    assert.equal("const b".slice(add[0]![0]!.start, add[0]![0]!.end), "b");
  });

  it("single line over 400 chars triggers gate (empty ranges)", () => {
    const long = "x".repeat(WORD_EMPH_MAX_LINE_CHARS + 1);
    const { del, add } = wordRangesForRun([long], [`y${long.slice(1)}`]);
    assert.deepEqual(del[0], []);
    assert.deepEqual(add[0], []);
  });

  it("degraded option returns all empty ranges", () => {
    const { del, add } = wordRangesForRun(["a"], ["b"], { degraded: true });
    assert.deepEqual(del[0], []);
    assert.deepEqual(add[0], []);
  });

  it("identical pair yields empty ranges", () => {
    const { del, add } = wordRangesForRun(["same"], ["same"]);
    assert.deepEqual(del[0], []);
    assert.deepEqual(add[0], []);
  });
});
