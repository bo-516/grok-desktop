import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editDiffSummary } from "./editCollapse.js";

describe("editCollapse", () => {
  it("summarizes additions", () => {
    assert.equal(editDiffSummary("", "a\nb"), "+2/-0");
  });
});
