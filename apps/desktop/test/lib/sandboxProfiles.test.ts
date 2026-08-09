import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sandboxChangeRequiresRestart,
  sandboxNetworkHonestyNote,
  SANDBOX_PROFILES,
} from "@/lib/sandboxProfiles";

describe("desktop sandboxProfiles", () => {
  it("warns on macOS for strict", () => {
    const note = sandboxNetworkHonestyNote("darwin", "strict");
    assert.ok(note);
    assert.match(note!, /no-op/i);
  });
  it("requires restart", () => {
    assert.equal(sandboxChangeRequiresRestart(), true);
  });
  it("has five profiles", () => {
    assert.equal(SANDBOX_PROFILES.length, 5);
  });
});
