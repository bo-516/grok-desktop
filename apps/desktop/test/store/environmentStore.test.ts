/**
 * Pure helpers on the environment store (loaded-ago label, staleness constant).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENVIRONMENT_STALE_MS,
  formatLoadedAgo,
} from "@/store/environmentStore";

describe("formatLoadedAgo", () => {
  it("returns null when never loaded", () => {
    assert.equal(formatLoadedAgo(null, 1_000_000), null);
  });

  it("formats just now / seconds / minutes", () => {
    const now = 1_000_000;
    assert.equal(formatLoadedAgo(now - 3_000, now), "just now");
    assert.equal(formatLoadedAgo(now - 30_000, now), "30s ago");
    assert.equal(formatLoadedAgo(now - 120_000, now), "2m ago");
  });
});

describe("ENVIRONMENT_STALE_MS", () => {
  it("is 60 seconds", () => {
    assert.equal(ENVIRONMENT_STALE_MS, 60_000);
  });
});
