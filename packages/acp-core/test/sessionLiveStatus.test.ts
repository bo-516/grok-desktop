/**
 * Live-status restore helpers used after session/load idle hydrates.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  shouldArmQuietSettle,
  withLiveStreamingStatus,
} from "../src/index.js";

describe("withLiveStreamingStatus", () => {
  it("promotes idle to streaming and keeps permission / disconnected", () => {
    const idle = createSessionState({ id: "s1" });
    const live = withLiveStreamingStatus(idle);
    assert.equal(live.status, "streaming");
    assert.notEqual(live, idle);

    const perm = { ...idle, status: "waiting_permission" as const };
    assert.equal(withLiveStreamingStatus(perm), perm);

    const dead = { ...idle, status: "disconnected" as const };
    assert.equal(withLiveStreamingStatus(dead), dead);

    const already = { ...idle, status: "streaming" as const };
    assert.equal(withLiveStreamingStatus(already), already);
  });
});

describe("shouldArmQuietSettle", () => {
  it("skips the short settle until this process has sent a prompt", () => {
    assert.equal(
      shouldArmQuietSettle({
        promptOriginated: false,
        promptInFlight: false,
      }),
      false,
    );
    assert.equal(
      shouldArmQuietSettle({
        promptOriginated: true,
        promptInFlight: false,
      }),
      true,
    );
    assert.equal(
      shouldArmQuietSettle({
        force: true,
        promptOriginated: false,
        promptInFlight: false,
      }),
      true,
    );
  });
});
