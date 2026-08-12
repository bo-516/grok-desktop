/**
 * changeRunsFromFileDiff order/length ≡ createDiffReview().hunks.
 * Includes adjacent runs and post gap-reveal invariance.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changeRunsFromFileDiff,
  diffRowKey,
} from "@/lib/diffChangeRuns";
import { buildFileDiff } from "@/lib/diffCore";
import { expandGap, splitDiffSourceLines } from "@/lib/diffGapExpand";
import { createDiffReview } from "@/lib/diffHunkApply";
import type { DiffGap, DiffHunkBlock, FileDiff } from "@/lib/diffCore";

/** Fixtures: multi-sample old/new pairs. */
const FIXTURES: Array<{ name: string; old: string; next: string }> = [
  {
    name: "single substitution",
    old: "a\nb\nc\n",
    next: "a\nB\nc\n",
  },
  {
    name: "two distant changes",
    old: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n",
    next: "1\nX\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\nY\n14\n15\n",
  },
  {
    name: "adjacent change runs with context",
    old: "line0\nline1\nline2\nline3\nline4\n",
    next: "line0\nLINE1\nLINE2\nline3\nline4\n",
  },
  {
    name: "add only",
    old: "a\nb\n",
    next: "a\nx\ny\nb\n",
  },
  {
    name: "del only",
    old: "a\nx\ny\nb\n",
    next: "a\nb\n",
  },
  {
    name: "close changes within one structured hunk",
    // context=3 folds small same-runs into one structured hunk; review still
    // splits on every same line into multiple change runs.
    old: "p\nq\nr\ns\nt\nu\nv\n",
    next: "p\nQ\nr\nS\nt\nu\nv\n",
  },
];

describe("diffChangeRuns", () => {
  for (const fx of FIXTURES) {
    it(`length/order matches createDiffReview: ${fx.name}`, () => {
      const fileDiff = buildFileDiff(fx.old, fx.next);
      const runs = changeRunsFromFileDiff(fileDiff);
      const review = createDiffReview(fx.old, fx.next);
      assert.equal(
        runs.length,
        review.hunks.length,
        `run count mismatch for ${fx.name}`,
      );
      for (let i = 0; i < runs.length; i += 1) {
        assert.equal(runs[i]!.index, i);
        const reviewLines = review.hunks[i]!.lines.filter(
          (l) => l.type !== "same",
        );
        assert.equal(runs[i]!.rowKeys.length, reviewLines.length);
      }
    });
  }

  it("gap reveal only inserts same rows — run count/order unchanged", () => {
    // Large enough unmodified middle to produce a real gap (context*2+1 = 7).
    const oldLines = Array.from({ length: 40 }, (_, i) => `L${i}`);
    const newLines = [...oldLines];
    newLines[2] = "CHANGED_TOP";
    newLines[35] = "CHANGED_BOT";
    const old = `${oldLines.join("\n")}\n`;
    const next = `${newLines.join("\n")}\n`;
    const fileDiff = buildFileDiff(old, next);
    const before = changeRunsFromFileDiff(fileDiff);
    const review = createDiffReview(old, next);
    assert.equal(before.length, review.hunks.length);
    assert.ok(before.length >= 2, "expected two distant change runs");

    // Simulate painting with a gap fully expanded into same rows inserted
    // between hunks — rebuild blocks with gap replaced by same rows.
    const expanded = expandGapsInFileDiff(fileDiff, old, next, "all");
    const after = changeRunsFromFileDiff(expanded);
    assert.equal(after.length, before.length);
    for (let i = 0; i < before.length; i += 1) {
      assert.deepEqual(after[i]!.rowKeys, before[i]!.rowKeys);
      assert.equal(after[i]!.added, before[i]!.added);
      assert.equal(after[i]!.removed, before[i]!.removed);
    }
  });

  it("diffRowKey is stable for dual-numbered rows", () => {
    assert.equal(
      diffRowKey({ type: "add", newNo: 3 }),
      "add::3",
    );
    assert.equal(
      diffRowKey({ type: "del", oldNo: 2 }),
      "del:2:",
    );
  });
});

/**
 * Replace every gap with fully revealed same rows (for invariance testing).
 * Does not re-run the engine — mirrors the production expand path.
 */
function expandGapsInFileDiff(
  fileDiff: FileDiff,
  oldText: string,
  newText: string,
  mode: "all",
): FileDiff {
  void mode;
  const oldSrc = splitDiffSourceLines(oldText);
  const newSrc = splitDiffSourceLines(newText);
  const blocks: FileDiff["blocks"] = [];
  for (const block of fileDiff.blocks) {
    if (block.kind === "hunk") {
      blocks.push(block);
      continue;
    }
    const gap = block as DiffGap;
    const { head, remaining, tail } = expandGap(gap, newSrc, oldSrc, {
      top: gap.count,
      bottom: 0,
    });
    if (head.length > 0) {
      const synthetic: DiffHunkBlock = {
        kind: "hunk",
        oldStart: head[0]!.oldNo ?? gap.oldStart,
        oldCount: head.length,
        newStart: head[0]!.newNo ?? gap.newStart,
        newCount: head.length,
        rows: head,
      };
      blocks.push(synthetic);
    }
    if (remaining) {
      blocks.push(remaining);
    }
    if (tail.length > 0) {
      const synthetic: DiffHunkBlock = {
        kind: "hunk",
        oldStart: tail[0]!.oldNo ?? gap.oldStart,
        oldCount: tail.length,
        newStart: tail[0]!.newNo ?? gap.newStart,
        newCount: tail.length,
        rows: tail,
      };
      blocks.push(synthetic);
    }
  }
  return { ...fileDiff, blocks };
}
