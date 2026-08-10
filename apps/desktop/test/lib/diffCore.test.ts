/**
 * D4 regression: line-level diffs via shipped buildFileDiff / buildLineDiff /
 * applyHunkDecisions (jsdiff adapter). Not a reimplementation of the algorithm.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFileDiff,
  DIFF_MAX_EDIT_LENGTH,
  type DiffHunkBlock,
} from "@/lib/diffCore";
import { buildLineDiff } from "@/lib/diffReview";
import {
  applyHunkDecisions,
  createDiffReview,
} from "@/lib/diffHunkApply";

describe("diffCore regression (§1.2)", () => {
  it("log/a/log/b → a/log/b is +0/−1", () => {
    const oldT = "log()\na\nlog()\nb";
    const newT = "a\nlog()\nb";
    const h = buildLineDiff(oldT, newT);
    assert.equal(h.added, 0);
    assert.equal(h.removed, 1);
  });

  it("2000-line repeated content delete first line is +0/−1", () => {
    const lines = Array.from({ length: 2000 }, (_, i) =>
      i % 50 === 0 ? "repeat-marker" : `line-${i % 50}`,
    );
    const oldT = lines.join("\n");
    const newT = lines.slice(1).join("\n");
    const h = buildLineDiff(oldT, newT);
    assert.equal(h.added, 0);
    assert.equal(h.removed, 1);
  });

  it("3000-line file with 20 edits is +20/−20", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line-${i}`);
    const oldT = lines.join("\n") + "\n";
    const edited = lines.slice();
    for (let k = 0; k < 20; k += 1) {
      const idx = 50 + k * 100;
      edited[idx] = `changed-${k}`;
    }
    const newT = edited.join("\n") + "\n";
    const h = buildLineDiff(oldT, newT);
    assert.equal(h.added, 20);
    assert.equal(h.removed, 20);
  });
});

describe("diffCore dual line numbers + hunk shape", () => {
  it("assigns oldNo/newNo correctly on del/add/same", () => {
    const oldT = "a\nb\nc\n";
    const newT = "a\nx\nc\n";
    const file = buildFileDiff(oldT, newT);
    const hunk = file.blocks.find((b): b is DiffHunkBlock => b.kind === "hunk");
    assert.ok(hunk);
    const del = hunk.rows.find((r) => r.type === "del");
    const add = hunk.rows.find((r) => r.type === "add");
    const same = hunk.rows.filter((r) => r.type === "same");
    assert.ok(del);
    assert.ok(add);
    assert.equal(del.newNo, undefined);
    assert.ok(typeof del.oldNo === "number");
    assert.equal(add.oldNo, undefined);
    assert.ok(typeof add.newNo === "number");
    for (const s of same) {
      assert.ok(typeof s.oldNo === "number");
      assert.ok(typeof s.newNo === "number");
    }
  });

  it("single-line change produces one hunk with context rows", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const oldT = lines.join("\n") + "\n";
    const edited = lines.slice();
    edited[4] = "CHANGED";
    const newT = edited.join("\n") + "\n";
    const file = buildFileDiff(oldT, newT, { context: 3 });
    const hunks = file.blocks.filter(
      (b): b is DiffHunkBlock => b.kind === "hunk",
    );
    assert.equal(hunks.length, 1);
    // 3 context + del + add + 3 context = 8
    assert.equal(hunks[0]!.rows.length, 8);
  });
});

describe("diffCore trailing newline round-trip via applyHunkDecisions", () => {
  it("accept-all preserves trailing newline", () => {
    const oldT = "a\nb\n";
    const newT = "a\nx\n";
    const { hunks } = createDiffReview(oldT, newT);
    const accepted = hunks.map((h) => ({ ...h, decision: "accept" as const }));
    assert.equal(applyHunkDecisions(oldT, newT, accepted), "a\nx\n");
  });

  it("reject-all preserves trailing newline on old", () => {
    const oldT = "a\nb\n";
    const newT = "a\nx\n";
    const { hunks } = createDiffReview(oldT, newT);
    const rejected = hunks.map((h) => ({ ...h, decision: "reject" as const }));
    assert.equal(applyHunkDecisions(oldT, newT, rejected), "a\nb\n");
  });

  it("accept-all does not invent trailing newline when absent", () => {
    const oldT = "a\nb";
    const newT = "a\nx";
    const { hunks } = createDiffReview(oldT, newT);
    const accepted = hunks.map((h) => ({ ...h, decision: "accept" as const }));
    assert.equal(applyHunkDecisions(oldT, newT, accepted), "a\nx");
  });

  it("reject-all does not invent trailing newline when absent", () => {
    const oldT = "a\nb";
    const newT = "a\nx";
    const { hunks } = createDiffReview(oldT, newT);
    const rejected = hunks.map((h) => ({ ...h, decision: "reject" as const }));
    assert.equal(applyHunkDecisions(oldT, newT, rejected), "a\nb");
  });
});

describe("diffCore degrade gates", () => {
  it("near-total rewrite on 8000 lines sets degraded within a bound", () => {
    const n = 8000;
    const oldT =
      Array.from({ length: n }, (_, i) => `old-${i}`).join("\n") + "\n";
    const newT =
      Array.from({ length: n }, (_, i) => `new-${i}`).join("\n") + "\n";
    const t0 = performance.now();
    const file = buildFileDiff(oldT, newT, {
      maxEditLength: DIFF_MAX_EDIT_LENGTH,
    });
    const ms = performance.now() - t0;
    assert.equal(file.degraded, true);
    // Generous wall-clock bound: cap path is ~150ms in design; allow 2s CI noise.
    assert.ok(ms < 2000, `expected degrade bail under 2000ms, got ${ms}ms`);
  });

  it("3000 lines / 600 edits is not degraded under design cap", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line-${i}`);
    const oldT = lines.join("\n") + "\n";
    const edited = lines.slice();
    for (let k = 0; k < 600; k += 1) {
      const idx = Math.floor((k * 3000) / 600);
      edited[idx] = `changed-${k}`;
    }
    const newT = edited.join("\n") + "\n";
    const file = buildFileDiff(oldT, newT, {
      maxEditLength: DIFF_MAX_EDIT_LENGTH,
    });
    assert.notEqual(file.degraded, true);
    assert.equal(file.added, 600);
    assert.equal(file.removed, 600);
  });
});
