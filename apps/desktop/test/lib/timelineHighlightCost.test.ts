/**
 * What off-screen Shiki would cost if every settled fence tokenized on mount.
 * The product path defers those fences; this measures the work that deferral
 * skips. One warmup call pays for the grammar load and is not in the average.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { highlightToLines } from "@/lib/codeHighlight";

/** Fences timed back-to-back after the grammar is warm. */
const FENCE_COUNT = 30;

/** Representative settled-turn fence (small, but a real grammar). */
const SAMPLE = [
  "export function settle(turn: number) {",
  "  const label = `turn ${turn}`;",
  "  if (turn < 0) {",
  "    return label;",
  "  }",
  "  return label.toUpperCase();",
  "}",
].join("\n");

describe("off-screen highlight cost", () => {
  it("tokenizes a settled-turn fence and reports the warm cost", async () => {
    const warmup = await highlightToLines(SAMPLE, "typescript");
    assert.ok(warmup && warmup.length > 0);

    const started = performance.now();
    for (let index = 0; index < FENCE_COUNT; index += 1) {
      const lines = await highlightToLines(SAMPLE, "typescript");
      assert.ok(lines && lines.length > 0);
    }
    const elapsed = performance.now() - started;
    const perFence = elapsed / FENCE_COUNT;
    console.log(
      `[timeline-shiki] warm ${FENCE_COUNT} typescript fences in ${elapsed.toFixed(1)}ms ` +
        `(${perFence.toFixed(2)}ms each; 200 fences ≈ ${(perFence * 200).toFixed(0)}ms)`,
    );
    assert.ok(perFence < 500, `fence tokenize unexpectedly slow: ${perFence}ms`);
  });
});
