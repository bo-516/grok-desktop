/**
 * Full-file reconstruction + Apply whole-file safety (doc §7).
 * Drives shipped reconstructFullTexts / canApplyWholeFile / fragmentsAreContinuous.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canApplyWholeFile,
  findLineSubsequenceStarts,
  fragmentsAreContinuous,
  reconstructFullTexts,
  splitLinesForMatch,
} from "@/lib/diffFullFile";

describe("canApplyWholeFile", () => {
  it("true only when disk === newText", () => {
    assert.equal(canApplyWholeFile("full\nfile\n", "full\nfile\n"), true);
    assert.equal(canApplyWholeFile("full\nfile\n", "file\n"), false);
    assert.equal(canApplyWholeFile("", ""), true);
  });
});

describe("reconstructFullTexts", () => {
  it("fragment equal to disk → whole", () => {
    const disk = "a\nb\nc\n";
    const r = reconstructFullTexts(disk, "a\nb\nc\n", disk);
    assert.equal(r.kind, "whole");
    if (r.kind === "whole") {
      assert.equal(r.oldText, "a\nb\nc\n");
      assert.equal(r.newText, disk);
    }
  });

  it("unique window mid-file → window with correct startLine and line counts", () => {
    const head = Array.from({ length: 44 }, (_, i) => `head-${i}`).join("\n");
    const fragOld = "old-one\nold-two\nold-three";
    const fragNew = "new-one\nnew-two\nnew-three";
    const tail = Array.from({ length: 10 }, (_, i) => `tail-${i}`).join("\n");
    const disk = `${head}\n${fragNew}\n${tail}\n`;
    const r = reconstructFullTexts(disk, fragOld, fragNew);
    assert.equal(r.kind, "window");
    if (r.kind !== "window") {
      return;
    }
    // head has 44 lines → fragment starts at line 45
    assert.equal(r.startLine, 45);
    assert.equal(r.newText, disk);
    const oldLines = splitLinesForMatch(r.oldText);
    const diskLines = splitLinesForMatch(disk);
    const fragNewLines = splitLinesForMatch(fragNew);
    const fragOldLines = splitLinesForMatch(fragOld);
    // oldText line count = disk − (fragNew − fragOld)
    assert.equal(
      oldLines.length,
      diskLines.length - (fragNewLines.length - fragOldLines.length),
    );
    assert.ok(r.oldText.includes("old-one"));
    assert.ok(!r.oldText.includes("new-one"));
    assert.ok(r.oldText.startsWith("head-0"));
    assert.ok(r.oldText.includes("tail-0"));
  });

  it("zero matches → not_found", () => {
    const r = reconstructFullTexts("aaa\nbbb\n", "x\n", "ccc\n");
    assert.deepEqual(r, { kind: "unavailable", reason: "not_found" });
  });

  it("two matches → ambiguous", () => {
    const fragNew = "dup\nline";
    const disk = `a\n${fragNew}\nb\n${fragNew}\nc\n`;
    const r = reconstructFullTexts(disk, "old\n", fragNew);
    assert.deepEqual(r, { kind: "unavailable", reason: "ambiguous" });
  });

  it("line-boundary only: mid-line infix does not match", () => {
    // fragNew lines are a mid-line substring of a disk line, not whole lines.
    const disk = "prefix-TARGET-suffix\nother\n";
    const fragNew = "TARGET";
    const starts = findLineSubsequenceStarts(
      splitLinesForMatch(disk),
      splitLinesForMatch(fragNew),
    );
    assert.equal(starts.length, 0);
    const r = reconstructFullTexts(disk, "OLD", fragNew);
    assert.equal(r.kind, "unavailable");
    if (r.kind === "unavailable") {
      assert.equal(r.reason, "not_found");
    }
  });

  it("empty fragNew → empty_frag", () => {
    const r = reconstructFullTexts("still here\n", "gone\n", "");
    assert.deepEqual(r, { kind: "unavailable", reason: "empty_frag" });
  });
});

describe("fragmentsAreContinuous", () => {
  it("equal prior new and next old → continuous", () => {
    assert.equal(fragmentsAreContinuous("a\nb\n", "a\nb\n"), true);
  });

  it("next old as subsequence of prior → continuous", () => {
    assert.equal(
      fragmentsAreContinuous("a\nb\nc\nd\n", "b\nc\n"),
      true,
    );
  });

  it("unrelated windows → not continuous", () => {
    assert.equal(
      fragmentsAreContinuous("window-one\nbody\n", "other-window\nbody\n"),
      false,
    );
  });
});

describe("Apply safety on fixtures", () => {
  it("whole-file equal disk: can apply; window cannot until reconstruct", () => {
    const whole = "line1\nline2\nline3\n";
    assert.equal(canApplyWholeFile(whole, whole), true);

    const head = "h0\nh1\nh2\n";
    const fragNew = "n0\nn1\n";
    const tail = "t0\n";
    const disk = `${head}${fragNew}${tail}`;
    assert.equal(canApplyWholeFile(disk, fragNew), false);

    const recon = reconstructFullTexts(disk, "o0\no1\n", fragNew);
    assert.equal(recon.kind, "window");
    if (recon.kind === "window") {
      assert.equal(canApplyWholeFile(disk, recon.newText), true);
      assert.equal(recon.newText.length, disk.length);
    }
  });
});
