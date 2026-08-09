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
});
