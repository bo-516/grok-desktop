/**
 * Context-usage prefs normalize / visibility helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isContextUsageVisible,
  normalizeContextUsagePrefs,
} from "@/lib/contextUsagePrefs";

describe("contextUsagePrefs", () => {
  it("defaults showContextUsage to true", () => {
    assert.deepEqual(normalizeContextUsagePrefs(undefined), {
      showContextUsage: true,
    });
    assert.deepEqual(normalizeContextUsagePrefs({}), {
      showContextUsage: true,
    });
  });

  it("accepts explicit true/false only", () => {
    assert.equal(
      normalizeContextUsagePrefs({ showContextUsage: false }).showContextUsage,
      false,
    );
    assert.equal(
      normalizeContextUsagePrefs({ showContextUsage: true }).showContextUsage,
      true,
    );
    assert.equal(
      normalizeContextUsagePrefs({ showContextUsage: "yes" }).showContextUsage,
      true,
    );
  });

  it("isContextUsageVisible mirrors the flag", () => {
    assert.equal(isContextUsageVisible({ showContextUsage: true }), true);
    assert.equal(isContextUsageVisible({ showContextUsage: false }), false);
  });
});
