/**
 * F-NATIVE-06: per-hunk accept/reject must change applied file text.
 * Drives shipped applyHunkDecisions — not a reimplementation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyHunkDecisions,
  createDiffReview,
  setHunkDecision,
} from "@/lib/diffHunkApply";

describe("diffHunkApply", () => {
  it("accept all keeps new text", () => {
    const oldT = "a\nb\nc";
    const newT = "a\nx\nc";
    const { hunks } = createDiffReview(oldT, newT);
    assert.ok(hunks.length >= 1);
    const accepted = hunks.map((h) => ({ ...h, decision: "accept" as const }));
    const result = applyHunkDecisions(oldT, newT, accepted);
    assert.equal(result, "a\nx\nc");
  });

  it("reject all restores old text", () => {
    const oldT = "a\nb\nc";
    const newT = "a\nx\nc";
    const { hunks } = createDiffReview(oldT, newT);
    const rejected = hunks.map((h) => ({ ...h, decision: "reject" as const }));
    const result = applyHunkDecisions(oldT, newT, rejected);
    assert.equal(result, "a\nb\nc");
  });

  it("setHunkDecision updates one hunk", () => {
    const { hunks } = createDiffReview("a\nb", "a\nc");
    const next = setHunkDecision(hunks, hunks[0]!.id, "reject");
    assert.equal(next[0]?.decision, "reject");
  });

  it("createDiffReview rebuilds from new texts when target switches", () => {
    // DiffReviewView resets state from createDiffReview when path/old/new change.
    const first = createDiffReview("a\nb\n", "a\nx\n");
    assert.ok(first.hunks.length >= 1);
    const second = createDiffReview("p\nq\nr\n", "p\nQ\nR\nr\n");
    assert.ok(second.hunks.length >= 1);
    // Different content must produce different review material (not a cached first).
    const firstTexts = first.hunks.flatMap((h) => h.lines.map((l) => l.text));
    const secondTexts = second.hunks.flatMap((h) => h.lines.map((l) => l.text));
    assert.notDeepEqual(firstTexts, secondTexts);
    assert.ok(firstTexts.includes("b") || firstTexts.includes("x"));
    assert.ok(secondTexts.includes("Q") || secondTexts.includes("q"));
  });
});
