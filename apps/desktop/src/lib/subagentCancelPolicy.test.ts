import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveSubagentCancel,
  shouldStopSubagents,
} from "./subagentCancelPolicy.js";

describe("subagentCancelPolicy", () => {
  it("prefers interactive choice", () => {
    assert.equal(
      resolveSubagentCancel("always_continue", "always_stop"),
      "always_stop",
    );
  });
  it("maps stop choice", () => {
    assert.equal(shouldStopSubagents("always_stop"), true);
    assert.equal(shouldStopSubagents("always_continue"), false);
  });
});
