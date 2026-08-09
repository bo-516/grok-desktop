import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toggleTheme } from "@/lib/theme";

describe("theme", () => {
  it("toggles dark ↔ light", () => {
    assert.equal(toggleTheme("dark"), "light");
    assert.equal(toggleTheme("light"), "dark");
  });
});
