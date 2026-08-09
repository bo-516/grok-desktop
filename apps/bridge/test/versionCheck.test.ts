/**
 * Version floor tests (TC-OPS-01).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareSemver,
  isGrokVersionSupported,
  parseSemver,
} from "../src/versionCheck.js";

describe("versionCheck", () => {
  it("parses grok --version style strings", () => {
    assert.deepEqual(parseSemver("grok 1.0.0 (3cd0d0cb)"), [1, 0, 0]);
    assert.deepEqual(parseSemver("0.8.1"), [0, 8, 1]);
  });

  it("rejects versions below floor", () => {
    const r = isGrokVersionSupported("grok 0.1.0", "0.9.0");
    assert.equal(r.ok, false);
    assert.match(r.message, /below the minimum/);
  });

  it("accepts current 1.x", () => {
    const r = isGrokVersionSupported("grok 1.0.0 (abc)", "0.9.0");
    assert.equal(r.ok, true);
  });

  it("compareSemver orders correctly", () => {
    assert.equal(compareSemver([1, 0, 0], [0, 9, 0]), 1);
    assert.equal(compareSemver([0, 9, 0], [0, 9, 1]), -1);
    assert.equal(compareSemver([1, 2, 3], [1, 2, 3]), 0);
  });
});
