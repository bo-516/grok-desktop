/**
 * Per-field catalog merges: empty inbound must not wipe maps / occupancy,
 * and subagent card output is capped for persist.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionTokenUsage, SubagentCard } from "@grok-desktop/acp-core";
import {
  CATALOG_SUBAGENT_OUTPUT_MAX,
  mergeCatalogMap,
  mergeCatalogTokenUsage,
  trimSubagentCardsForCatalog,
} from "@/store/sessionCatalogMerge";

/**
 * Minimal orchestration card for trim / merge tests.
 * @param partial Overrides; `subagentId` is required.
 */
function card(
  partial: Partial<SubagentCard> & { subagentId: string },
): SubagentCard {
  return {
    childSessionId: partial.childSessionId ?? partial.subagentId,
    type: "general-purpose",
    description: partial.description ?? partial.subagentId,
    status: "completed",
    ...partial,
  };
}

describe("mergeCatalogMap", () => {
  it("returns undefined when both sides are absent or empty", () => {
    assert.equal(mergeCatalogMap(undefined, undefined), undefined);
    assert.equal(mergeCatalogMap({}, {}), undefined);
    assert.equal(mergeCatalogMap({}, undefined), undefined);
  });

  it("keeps the non-empty side when the other is empty", () => {
    const existing = { a: 1 };
    const inbound = { b: 2 };
    assert.deepEqual(mergeCatalogMap(existing, undefined), existing);
    assert.deepEqual(mergeCatalogMap(existing, {}), existing);
    assert.deepEqual(mergeCatalogMap(undefined, inbound), inbound);
    assert.deepEqual(mergeCatalogMap({}, inbound), inbound);
  });

  it("unions keys and lets inbound win collisions", () => {
    const merged = mergeCatalogMap(
      { a: "old-a", b: "only-existing" },
      { a: "new-a", c: "only-inbound" },
    );
    assert.deepEqual(merged, {
      a: "new-a",
      b: "only-existing",
      c: "only-inbound",
    });
  });
});

describe("trimSubagentCardsForCatalog", () => {
  it("leaves empty / short maps unchanged", () => {
    assert.equal(trimSubagentCardsForCatalog(undefined), undefined);
    assert.deepEqual(trimSubagentCardsForCatalog({}), {});
    const short = { s1: card({ subagentId: "s1", output: "ok" }) };
    assert.equal(trimSubagentCardsForCatalog(short)?.s1?.output, "ok");
  });

  it("caps long output at CATALOG_SUBAGENT_OUTPUT_MAX without dropping the card", () => {
    const long = "x".repeat(CATALOG_SUBAGENT_OUTPUT_MAX + 80);
    const trimmed = trimSubagentCardsForCatalog({
      s1: card({ subagentId: "s1", output: long, status: "completed" }),
      s2: card({ subagentId: "s2", output: "short" }),
    });
    assert.equal(trimmed?.s1?.output?.length, CATALOG_SUBAGENT_OUTPUT_MAX);
    assert.equal(trimmed?.s1?.status, "completed");
    assert.equal(trimmed?.s2?.output, "short");
    assert.equal(Object.keys(trimmed ?? {}).length, 2);
  });
});

describe("mergeCatalogTokenUsage", () => {
  it("prefers inbound billed counters and keeps catalog occupancy", () => {
    const existing: SessionTokenUsage = {
      inputTokens: 10,
      outputTokens: 2,
      totalTokens: 12,
      contextTokensUsed: 80_000,
    };
    const inbound: SessionTokenUsage = {
      inputTokens: 1_200_000,
      outputTokens: 50,
      totalTokens: 1_200_050,
    };
    const merged = mergeCatalogTokenUsage(existing, inbound);
    assert.equal(merged?.inputTokens, 1_200_000);
    assert.equal(merged?.outputTokens, 50);
    assert.equal(merged?.contextTokensUsed, 80_000);
  });

  it("returns the present side when the other is missing", () => {
    const snap: SessionTokenUsage = {
      inputTokens: 1,
      outputTokens: 0,
      totalTokens: 1,
    };
    assert.equal(mergeCatalogTokenUsage(snap, undefined), snap);
    assert.equal(mergeCatalogTokenUsage(undefined, snap), snap);
    assert.equal(mergeCatalogTokenUsage(undefined, undefined), undefined);
  });
});
