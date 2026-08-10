/**
 * Canvas follow rules for New chat draft vs forceNew handshake.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  resolveCanvasFollow,
  shouldFollowSession,
} from "@/store/sessionStoreLiveFollow";

describe("resolveCanvasFollow", () => {
  it("does not follow pool traffic on an explicit New chat draft", () => {
    const inbound = createSessionState({
      id: "old-streaming",
      workspace: "/w",
    });
    inbound.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hi" }],
      },
    ];
    assert.equal(
      resolveCanvasFollow({
        viewing: null,
        active: "old-streaming",
        localDraft: true,
        creatingSession: false,
        inbound,
      }),
      false,
    );
  });

  it("cold reconnect (not localDraft) still follows first inbound session", () => {
    const inbound = createSessionState({
      id: "first-boot",
      workspace: "/w",
    });
    assert.equal(
      resolveCanvasFollow({
        viewing: null,
        active: null,
        localDraft: false,
        creatingSession: false,
        inbound,
      }),
      true,
    );
  });

  it("follows a fresh empty session while forceNew creating a draft", () => {
    const inbound = createSessionState({
      id: "brand-new",
      workspace: "/w",
    });
    assert.equal(
      resolveCanvasFollow({
        viewing: null,
        active: null,
        localDraft: true,
        creatingSession: true,
        inbound,
      }),
      true,
    );
  });

  it("rejects a content-rich pool session while forceNew creating", () => {
    const inbound = createSessionState({
      id: "old-streaming",
      workspace: "/w",
    });
    inbound.timeline = [
      { kind: "agent", id: "a1", text: "still going" },
    ];
    assert.equal(
      resolveCanvasFollow({
        viewing: null,
        active: "old-streaming",
        localDraft: true,
        creatingSession: true,
        inbound,
      }),
      false,
    );
  });

  it("uses normal shouldFollow once not on a local draft", () => {
    const inbound = createSessionState({
      id: "focus-me",
      workspace: "/w",
    });
    assert.equal(
      resolveCanvasFollow({
        viewing: "focus-me",
        active: "focus-me",
        localDraft: false,
        creatingSession: false,
        inbound,
      }),
      true,
    );
    assert.equal(
      resolveCanvasFollow({
        viewing: "focus-me",
        active: "focus-me",
        localDraft: false,
        creatingSession: false,
        inbound: createSessionState({ id: "other", workspace: "/w" }),
      }),
      false,
    );
  });
});

describe("shouldFollowSession", () => {
  it("follows when viewing is null (legacy first-connect)", () => {
    assert.equal(shouldFollowSession(null, null, "any"), true);
  });

  it("isolates the viewed chat from a concurrently streaming active chat", () => {
    assert.equal(
      shouldFollowSession("viewed", "background", "viewed"),
      true,
    );
    assert.equal(
      shouldFollowSession("viewed", "background", "background"),
      false,
    );
    assert.equal(shouldFollowSession("viewed", "background", ""), false);
  });

  it("uses active only before the rail establishes an explicit viewing id", () => {
    assert.equal(shouldFollowSession(null, "active", "active"), true);
    assert.equal(shouldFollowSession(null, "active", "background"), false);
  });
});
