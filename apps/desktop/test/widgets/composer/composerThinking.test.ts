/**
 * Catalog-to-thinking-menu mapper: unmatched / empty modelId must not inherit
 * availableModels[0]. Drives shipped thinkingFromAvailableModels.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AvailableModel } from "@grok-desktop/acp-core";
import { advertisedEffortsForModel } from "@/lib/slashBuiltins";
import {
  resolveThinkingOptions,
  thinkingFromAvailableModels,
} from "@/widgets/composer/composerThinking";

/** Catalog where row 0 is 4.6 (Extra High) so a fallthrough would be visible. */
const CATALOG: AvailableModel[] = [
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    reasoningEfforts: [
      { id: "low" },
      { id: "medium" },
      { id: "high" },
      { id: "xhigh", label: "Extra High" },
    ],
  },
  {
    id: "grok-4.5",
    name: "Grok 4.5",
    reasoningEfforts: [{ id: "low" }, { id: "medium" }, { id: "high" }],
  },
];

describe("thinkingFromAvailableModels", () => {
  it("returns [] for an empty modelId even when the catalog is non-empty", () => {
    assert.deepEqual(thinkingFromAvailableModels("", CATALOG), []);
    assert.deepEqual(thinkingFromAvailableModels("   ", CATALOG), []);
    assert.deepEqual(thinkingFromAvailableModels(undefined, CATALOG), []);
  });

  it("returns [] for a modelId that is not in the catalog", () => {
    assert.deepEqual(thinkingFromAvailableModels("unknown-model", CATALOG), []);
  });

  it("returns advertised wire ids in catalog order for a matching model", () => {
    const rows = thinkingFromAvailableModels("grok-4.6", CATALOG);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["low", "medium", "high", "xhigh"],
    );
    const byName = thinkingFromAvailableModels("Grok 4.5", CATALOG);
    assert.deepEqual(
      byName.map((row) => row.id),
      ["low", "medium", "high"],
    );
  });

  it("resolveThinkingOptions does not invent Extra High on a 4.5-only agent list", () => {
    const options = resolveThinkingOptions(
      [
        {
          id: "reasoning_effort",
          options: ["low", "medium", "high"],
        },
      ],
      "grok-4.6",
      CATALOG,
    );
    assert.deepEqual(
      options.map((row) => row.id),
      ["low", "medium", "high"],
    );
  });

  it("returns the same id list as advertisedEffortsForModel for the same inputs", () => {
    const cases: Array<string | undefined> = [
      "",
      "   ",
      undefined,
      "missing",
      "grok-4.5",
      "grok-4.6",
      "Grok 4.5",
    ];
    for (const modelId of cases) {
      const menu = thinkingFromAvailableModels(modelId, CATALOG).map(
        (row) => row.id,
      );
      const resolved = resolveThinkingOptions(undefined, modelId, CATALOG).map(
        (row) => row.id,
      );
      const slash = advertisedEffortsForModel(modelId, CATALOG).map(
        (row) => row.id,
      );
      assert.deepEqual(menu, slash, `modelId=${JSON.stringify(modelId)}`);
      assert.deepEqual(
        resolved,
        slash,
        `resolveThinkingOptions modelId=${JSON.stringify(modelId)}`,
      );
    }
  });
});
