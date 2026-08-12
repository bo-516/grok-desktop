/**
 * Pure entry helpers for user prompts (P-01..P-07).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addEntry,
  normalizeEntryText,
  overriddenEntryIds,
  removeEntry,
  reorderEntries,
  updateEntry,
  type PromptEntry,
} from "@/lib/userPrompts";

function e(
  id: string,
  text: string,
  opts: Partial<PromptEntry> = {},
): PromptEntry {
  return {
    id,
    text,
    enabled: opts.enabled !== false,
    ...(opts.category ? { category: opts.category } : {}),
  };
}

describe("userPrompts pure helpers", () => {
  it("P-01: addEntry appends enabled entry with unique id", () => {
    const a = addEntry([], "first");
    const b = addEntry(a, "second", "language");
    assert.equal(a.length, 1);
    assert.equal(b.length, 2);
    assert.equal(b[1]!.text, "second");
    assert.equal(b[1]!.enabled, true);
    assert.equal(b[1]!.category, "language");
    assert.notEqual(b[0]!.id, b[1]!.id);
  });

  it("P-02: updateEntry patches by id; order + other refs stable", () => {
    const base = [e("a", "one"), e("b", "two", { category: "name" })];
    const next = updateEntry(base, "b", {
      text: "two-edited",
      enabled: false,
      category: "style",
    });
    assert.equal(next[0], base[0]);
    assert.equal(next[1]!.text, "two-edited");
    assert.equal(next[1]!.enabled, false);
    assert.equal(next[1]!.category, "style");
    assert.equal(next[0]!.id, "a");
    assert.equal(next[1]!.id, "b");
  });

  it("P-03: removeEntry drops target; unknown id is no-op", () => {
    const base = [e("a", "one"), e("b", "two")];
    assert.equal(removeEntry(base, "nope"), base);
    assert.deepEqual(
      removeEntry(base, "a").map((x) => x.id),
      ["b"],
    );
  });

  it("P-04: remove all → empty array", () => {
    let list = [e("a", "one"), e("b", "two")];
    list = removeEntry(list, "a");
    list = removeEntry(list, "b");
    assert.deepEqual(list, []);
  });

  it("P-05: reorderEntries forward / back / clamp", () => {
    const base = [e("a", "1"), e("b", "2"), e("c", "3")];
    assert.deepEqual(
      reorderEntries(base, 0, 2).map((x) => x.id),
      ["b", "c", "a"],
    );
    assert.deepEqual(
      reorderEntries(base, 2, 0).map((x) => x.id),
      ["c", "a", "b"],
    );
    assert.deepEqual(
      reorderEntries(base, -1, 99).map((x) => x.id),
      ["b", "c", "a"],
    );
  });

  it("P-06: normalizeEntryText rules", () => {
    assert.deepEqual(normalizeEntryText("  hi  "), { ok: true, text: "hi" });
    assert.equal(
      normalizeEntryText("a\nb\tc").ok &&
        (normalizeEntryText("a\nb\tc") as { text: string }).text,
      "a b c",
    );
    assert.equal(normalizeEntryText("x\x00y").ok, true);
    assert.equal(
      (normalizeEntryText("x\x00y") as { text: string }).text,
      "xy",
    );
    assert.equal(normalizeEntryText("bad --> x").ok, false);
    assert.equal(normalizeEntryText("   ").ok, false);
    assert.equal(normalizeEntryText("x".repeat(2001)).ok, false);
  });

  it("P-07: overriddenEntryIds cross-layer category only", () => {
    const global = [e("g1", "Jack", { category: "name" }), e("g2", "free")];
    const project = [e("p1", "Tom", { category: "name" })];
    const local: PromptEntry[] = [];
    const ids = overriddenEntryIds([global, project, local]);
    assert.ok(ids.has("g1"));
    assert.equal(ids.has("g2"), false);
    assert.equal(ids.has("p1"), false);

    // Same layer duplicates do not mark override.
    const same = overriddenEntryIds([
      [e("a", "A", { category: "style" }), e("b", "B", { category: "style" })],
      [],
    ]);
    assert.equal(same.size, 0);
  });
});
