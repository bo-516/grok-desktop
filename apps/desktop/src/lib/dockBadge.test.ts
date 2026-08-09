import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatBadgedTitle } from "./dockBadge.js";

describe("dockBadge", () => {
  it("prefixes count when > 0", () => {
    assert.equal(formatBadgedTitle("Grok Desktop", 0), "Grok Desktop");
    assert.equal(formatBadgedTitle("Grok Desktop", 2), "(2) Grok Desktop");
  });
});
