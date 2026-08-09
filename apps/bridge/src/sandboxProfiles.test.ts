/**
 * Sandbox honesty + profile catalog tests (TC-SBX-03 / F-SBX-05).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSandboxProfile,
  sandboxChangeRequiresRestart,
  sandboxNetworkHonestyNote,
  SANDBOX_PROFILES,
} from "./sandboxProfiles.js";

describe("sandboxProfiles", () => {
  it("lists built-in profiles including strict", () => {
    assert.ok(SANDBOX_PROFILES.some((p) => p.id === "strict"));
    assert.ok(SANDBOX_PROFILES.some((p) => p.id === "read-only"));
  });

  it("warns on macOS for network-restricting profiles", () => {
    const note = sandboxNetworkHonestyNote("darwin", "strict");
    assert.ok(note);
    assert.match(note!, /no-op/i);
    assert.match(note!, /Linux/);
  });

  it("does not warn on Linux for strict", () => {
    assert.equal(sandboxNetworkHonestyNote("linux", "strict"), null);
  });

  it("does not claim network restrict for workspace", () => {
    assert.equal(sandboxNetworkHonestyNote("darwin", "workspace"), null);
  });

  it("SPAWN change always requires restart", () => {
    assert.equal(sandboxChangeRequiresRestart(), true);
  });

  it("parses known ids only", () => {
    assert.equal(parseSandboxProfile("strict"), "strict");
    assert.equal(parseSandboxProfile("nope"), null);
  });
});
