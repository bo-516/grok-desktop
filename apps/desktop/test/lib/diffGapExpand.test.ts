/**
 * Gap expand pure helpers: step/all/clamp and no-re-diff invariants.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampReveal,
  expandGap,
  fullRevealByGap,
  gapRevealKey,
  REVEAL_ALL_BELOW,
  REVEAL_STEP,
  revealAfterSourceChange,
  revealAll,
  splitDiffSourceLines,
  stepRevealBottom,
  stepRevealTop,
} from "@/lib/diffGapExpand";
import { buildFileDiff, type DiffGap, type FileDiff } from "@/lib/diffCore";
import { reconstructFullTexts } from "@/lib/diffFullFile";

/** Build a synthetic gap with known starts/count for fixture tests. */
function gap(count: number, oldStart = 10, newStart = 10): DiffGap {
  return { kind: "gap", count, oldStart, newStart };
}

/** Lines "L1"…"Ln" for 1-based indexing convenience. */
function lines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `L${i + 1}`);
}

describe("diffGapExpand", () => {
  it("gapRevealKey is stable and unique per start pair", () => {
    assert.equal(gapRevealKey({ oldStart: 4, newStart: 7 }), "4:7");
  });

  it("clampReveal trims bottom first when top+bottom exceed count", () => {
    assert.deepEqual(clampReveal(10, { top: 8, bottom: 5 }), {
      top: 8,
      bottom: 2,
    });
    assert.deepEqual(clampReveal(5, { top: 9, bottom: 9 }), {
      top: 5,
      bottom: 0,
    });
  });

  it("stepRevealTop releases REVEAL_STEP from the top", () => {
    const next = stepRevealTop(100, { top: 0, bottom: 0 });
    assert.equal(next.top, REVEAL_STEP);
    assert.equal(next.bottom, 0);
  });

  it("stepRevealBottom releases REVEAL_STEP from the bottom", () => {
    const next = stepRevealBottom(100, { top: 0, bottom: 0 });
    assert.equal(next.top, 0);
    assert.equal(next.bottom, REVEAL_STEP);
  });

  it("remaining ≤ REVEAL_ALL_BELOW reveals all on one step", () => {
    const count = REVEAL_ALL_BELOW; // 30
    const top = stepRevealTop(count, { top: 0, bottom: 0 });
    assert.equal(top.top + top.bottom, count);
    const bottom = stepRevealBottom(count, { top: 0, bottom: 0 });
    assert.equal(bottom.top + bottom.bottom, count);
  });

  it("remaining 25 lines after partial reveal finishes in one click", () => {
    // 45 total, top already 20 → remaining 25 ≤ 30
    const next = stepRevealTop(45, { top: 20, bottom: 0 });
    assert.equal(next.top, 45);
    assert.equal(next.bottom, 0);
  });

  it("expandGap head line numbers start at gap.newStart and are continuous", () => {
    const g = gap(40, 100, 200);
    const src = lines(250);
    const { head, remaining, tail } = expandGap(g, src, src, {
      top: REVEAL_STEP,
      bottom: 0,
    });
    assert.equal(head.length, REVEAL_STEP);
    assert.equal(head[0]?.newNo, 200);
    assert.equal(head[0]?.oldNo, 100);
    assert.equal(head[0]?.type, "same");
    for (let i = 1; i < head.length; i += 1) {
      assert.equal(head[i]!.newNo, head[i - 1]!.newNo! + 1);
      assert.equal(head[i]!.oldNo, head[i - 1]!.oldNo! + 1);
    }
    assert.equal(remaining?.count, 40 - REVEAL_STEP);
    assert.equal(remaining?.newStart, 200 + REVEAL_STEP);
    assert.equal(tail.length, 0);
  });

  it("expandGap tail last newNo + 1 meets the next hunk newStart", () => {
    const g = gap(40, 100, 200);
    const nextHunkNewStart = 200 + 40; // first line after gap
    const src = lines(300);
    const { tail, remaining } = expandGap(g, src, src, {
      top: 0,
      bottom: REVEAL_STEP,
    });
    assert.equal(tail.length, REVEAL_STEP);
    const last = tail[tail.length - 1]!;
    assert.equal(last.newNo! + 1, nextHunkNewStart);
    assert.equal(remaining?.count, 40 - REVEAL_STEP);
    assert.equal(remaining?.newStart, 200);
  });

  it("top + bottom >= count yields remaining === null", () => {
    const g = gap(25, 1, 1);
    const src = lines(40);
    const { remaining, head, tail } = expandGap(g, src, src, revealAll(25));
    assert.equal(remaining, null);
    assert.equal(head.length + tail.length, 25);
  });

  it("tail-delete file expand does not throw when new side is short", () => {
    // Gap references old lines past the new file end.
    const g = gap(10, 5, 5);
    const oldLines = lines(20);
    const newLines = lines(4); // only 4 lines on new side
    const { head, remaining } = expandGap(g, newLines, oldLines, {
      top: 5,
      bottom: 0,
    });
    // Falls back to old text; never throws; may stop early if both miss.
    assert.ok(Array.isArray(head));
    assert.ok(remaining === null || remaining.count >= 0);
    for (const row of head) {
      assert.equal(row.type, "same");
      assert.equal(typeof row.text, "string");
    }
  });

  it("splitDiffSourceLines matches trailing-newline semantics", () => {
    assert.deepEqual(splitDiffSourceLines(""), []);
    assert.deepEqual(splitDiffSourceLines("a\nb\n"), ["a", "b"]);
    assert.deepEqual(splitDiffSourceLines("a\nb"), ["a", "b"]);
  });

  it("expand only inserts same rows (change-run order invariant basis)", () => {
    const g = gap(15, 1, 1);
    const src = lines(30);
    const { head, tail } = expandGap(g, src, src, { top: 5, bottom: 5 });
    for (const row of [...head, ...tail]) {
      assert.equal(row.type, "same");
    }
  });
});

describe("revealAfterSourceChange / fullRevealByGap (reconstruct path)", () => {
  it("fullRevealByGap opens every gap with top === count", () => {
    const fileDiff: FileDiff = {
      blocks: [
        gap(40, 1, 1),
        {
          kind: "hunk",
          oldStart: 41,
          newStart: 41,
          rows: [{ type: "add", text: "x", newNo: 41 }],
        },
        gap(12, 42, 42),
      ],
      added: 1,
      removed: 0,
    };
    const map = fullRevealByGap(fileDiff);
    assert.deepEqual(map["1:1"], { top: 40, bottom: 0 });
    assert.deepEqual(map["42:42"], { top: 12, bottom: 0 });
    assert.equal(Object.keys(map).length, 2);
  });

  it("preferFullFile after reconstruct re-expands on new FileDiff keys", () => {
    // Window fragment → reconstruct full file → new gap geometry / keys.
    const head = Array.from({ length: 20 }, (_, i) => `h${i}`).join("\n");
    const tail = Array.from({ length: 30 }, (_, i) => `t${i}`).join("\n");
    const fragOld = "old-mid-a\nold-mid-b";
    const fragNew = "new-mid-a\nnew-mid-b";
    const disk = `${head}\n${fragNew}\n${tail}\n`;
    const fragDiff = buildFileDiff(fragOld, fragNew);
    // Simulate Show full file on fragment: expand fragment gaps.
    const preReveal = fullRevealByGap(fragDiff);
    assert.ok(Object.keys(preReveal).length >= 0);

    const recon = reconstructFullTexts(disk, fragOld, fragNew);
    assert.equal(recon.kind, "window");
    if (recon.kind !== "window") {
      return;
    }
    const fullDiff = buildFileDiff(recon.oldText, recon.newText);
    // Policy used by PreviewDiffWidget after texts update with preferFullFile.
    const post = revealAfterSourceChange(fullDiff, {
      preferFullFile: true,
      fullFileBlocked: false,
    });
    // Must not be empty wipe — sticky preferFullFile re-opens full-file gaps.
    const gapBlocks = fullDiff.blocks.filter((b) => b.kind === "gap");
    assert.ok(gapBlocks.length >= 1, "full-file diff should have context gaps");
    assert.equal(Object.keys(post).length, gapBlocks.length);
    for (const block of gapBlocks) {
      if (block.kind !== "gap") {
        continue;
      }
      const key = gapRevealKey(block);
      assert.ok(post[key], `missing reveal for ${key}`);
      assert.equal(post[key]!.top + post[key]!.bottom, block.count);
    }
    // Fragment-era keys must not be the sole survivors (geometry changed).
    // startLine shifts gap newStart; leading gap starts at 1 on full file.
    assert.ok(
      post["1:1"] || Object.keys(post).some((k) => k.startsWith("1:")),
      "expected a head-side gap key after full-file re-diff",
    );
  });

  it("without preferFullFile, source change clears reveal (no stale fragment keys)", () => {
    const fullDiff = buildFileDiff(
      "a\nb\nc\nd\ne\n",
      "a\nB\nc\nd\ne\n",
    );
    const cleared = revealAfterSourceChange(fullDiff, {
      preferFullFile: false,
      fullFileBlocked: false,
    });
    assert.deepEqual(cleared, {});
  });

  it("fullFileBlocked or degraded never expands even with preferFullFile", () => {
    const fileDiff: FileDiff = {
      blocks: [gap(100, 1, 1)],
      added: 0,
      removed: 0,
      degraded: true,
    };
    assert.deepEqual(
      revealAfterSourceChange(fileDiff, {
        preferFullFile: true,
        fullFileBlocked: false,
      }),
      {},
    );
    assert.deepEqual(
      revealAfterSourceChange(
        { blocks: [gap(100, 1, 1)], added: 0, removed: 0 },
        { preferFullFile: true, fullFileBlocked: true },
      ),
      {},
    );
  });
});
