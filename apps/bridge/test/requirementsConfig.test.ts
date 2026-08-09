import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isControlLocked,
  lockedSettingsFromRequirements,
  parseSimpleToml,
} from "../src/requirementsConfig.js";

describe("requirementsConfig", () => {
  it("parses disable_bypass_permissions_mode lock", () => {
    const parsed = parseSimpleToml(`
[permission]
disable_bypass_permissions_mode = true
`);
    const locks = lockedSettingsFromRequirements(parsed);
    const hit = isControlLocked(locks, "always_approve");
    assert.ok(hit);
    assert.match(hit!.reason, /disable_bypass_permissions_mode/);
  });
});
