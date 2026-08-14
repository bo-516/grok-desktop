/**
 * Context-usage prefs normalize / visibility helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isContextUsageVisible,
  isWeeklyUsageVisible,
  normalizeContextUsagePrefs,
} from "@/lib/contextUsagePrefs";

describe("contextUsagePrefs", () => {
  it("defaults both chrome flags to true", () => {
    assert.deepEqual(normalizeContextUsagePrefs(undefined), {
      showContextUsage: true,
      showWeeklyUsage: true,
    });
    assert.deepEqual(normalizeContextUsagePrefs({}), {
      showContextUsage: true,
      showWeeklyUsage: true,
    });
  });

  it("accepts explicit true/false only and keeps missing weekly on", () => {
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
    // Legacy blobs that only stored the context flag must not hide weekly.
    assert.equal(
      normalizeContextUsagePrefs({ showContextUsage: false }).showWeeklyUsage,
      true,
    );
    assert.equal(
      normalizeContextUsagePrefs({ showWeeklyUsage: false }).showWeeklyUsage,
      false,
    );
  });

  it("isContextUsageVisible / isWeeklyUsageVisible mirror the flags", () => {
    assert.equal(
      isContextUsageVisible({ showContextUsage: true, showWeeklyUsage: false }),
      true,
    );
    assert.equal(
      isContextUsageVisible({ showContextUsage: false, showWeeklyUsage: true }),
      false,
    );
    assert.equal(
      isWeeklyUsageVisible({ showContextUsage: false, showWeeklyUsage: true }),
      true,
    );
    assert.equal(
      isWeeklyUsageVisible({ showContextUsage: true, showWeeklyUsage: false }),
      false,
    );
  });
});
