/**
 * Canvas follow rules for New chat draft vs forceNew handshake.
 * Also covers mergeCanvasInbound empty-hydrate preservation (refresh wipe)
 * and preserveLocalUserMedia (image thumbs survive text-only agent echoes).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  mergeCanvasInbound,
  preserveLocalUserMedia,
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

describe("mergeCanvasInbound", () => {
  it("keeps catalog-seeded body when Go pool hit sends empty timeline", () => {
    const local = createSessionState({
      id: "019fef8c-39d7-7781-a866-78677d984376",
      workspace: "/w",
    });
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hello from cache" }],
      },
      { kind: "agent", id: "a1", text: "cached reply" },
    ];
    local.lastAgentText = "cached reply";
    const inbound = createSessionState({
      id: "019fef8c-39d7-7781-a866-78677d984376",
      workspace: "/w",
    });
    inbound.status = "idle";
    inbound.model = "grok-4.5";
    inbound.timeline = [];
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.timeline.length, 2);
    assert.equal(merged.lastAgentText, "cached reply");
    assert.equal(merged.model, "grok-4.5");
    assert.equal(merged.status, "idle");
  });

  it("does not promote an idle transcript when Go sends empty+streaming", () => {
    const local = createSessionState({ id: "s1", workspace: "/w" });
    local.status = "idle";
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "yesterday" }],
      },
      { kind: "agent", id: "a1", text: "already done" },
    ];
    const inbound = createSessionState({ id: "s1", workspace: "/w" });
    inbound.status = "streaming";
    inbound.timeline = [];
    inbound.model = "grok-4.6";
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.status, "idle");
    assert.equal(merged.timeline.length, 2);
    assert.equal(merged.model, "grok-4.6");
  });

  it("keeps a client slash catalog when Go hydrate omits availableCommands", () => {
    const local = createSessionState({
      id: "s-cmd",
      workspace: "/w",
    });
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "cached" }],
      },
    ];
    local.availableCommands = [
      { name: "compact", description: "Compress conversation history" },
      { name: "workflow", description: "Launch a saved workflow" },
    ];
    const inbound = createSessionState({
      id: "s-cmd",
      workspace: "/w",
    });
    inbound.timeline = [];
    inbound.availableCommands = [];
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.availableCommands?.length, 2);
    assert.equal(merged.availableCommands?.[0]?.name, "compact");
  });

  it("does not block a live partial that already has conversation content", () => {
    // Reduce-bucket seeding handles history; merge must not drop new turns.
    const local = createSessionState({ id: "s1", workspace: "/w" });
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "full history" }],
      },
      { kind: "agent", id: "a1", text: "long answer" },
    ];
    const inbound = createSessionState({ id: "s1", workspace: "/w" });
    inbound.timeline = [{ kind: "agent", id: "live1", text: "new chunk" }];
    inbound.lastAgentText = "new chunk";
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.timeline.length, 1);
    assert.equal(merged.lastAgentText, "new chunk");
  });

  it("accepts a longer inbound replay over a short local seed", () => {
    const local = createSessionState({ id: "s1", workspace: "/w" });
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "seed only" }],
      },
    ];
    const inbound = createSessionState({ id: "s1", workspace: "/w" });
    inbound.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "seed only" }],
      },
      { kind: "agent", id: "a1", text: "from load replay" },
    ];
    inbound.lastAgentText = "from load replay";
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.timeline.length, 2);
    assert.equal(merged.lastAgentText, "from load replay");
  });

  it("keeps optimistic local user on empty forceNew handshake", () => {
    const local = createSessionState({ id: "", workspace: "/w" });
    local.timeline = [
      {
        kind: "user",
        id: "local-u",
        blocks: [{ type: "text", text: "draft send" }],
        origin: "local",
        clientPromptId: "c1",
      },
    ];
    const inbound = createSessionState({ id: "new-id", workspace: "/w" });
    inbound.timeline = [];
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.timeline.length, 1);
    assert.equal(merged.status, "streaming");
  });

  it("keeps optimistic image blocks when inbound is text-only agent echo", () => {
    // Repro: thumbs paint on send, then vanish after user_message_chunk.
    const local = createSessionState({ id: "s1", workspace: "/demo" });
    local.timeline = [
      {
        kind: "user",
        id: "local-u",
        blocks: [
          { type: "text", text: "hi, see this image?" },
          { type: "image", mimeType: "image/png", data: "abc123" },
        ],
        origin: "local",
        clientPromptId: "c1",
        agentConfirmed: false,
      },
    ];
    const inbound = createSessionState({ id: "s1", workspace: "/demo" });
    inbound.timeline = [
      {
        kind: "user",
        id: "echo-u",
        blocks: [{ type: "text", text: "[Image #1]\nhi, see this image?" }],
        origin: "agent",
        agentConfirmed: true,
      },
      { kind: "agent", id: "a1", text: "Yes — I can see it." },
    ];
    inbound.lastAgentText = "Yes — I can see it.";
    const merged = mergeCanvasInbound(inbound, local);
    assert.equal(merged.timeline.length, 2);
    const user = merged.timeline[0];
    assert.equal(user?.kind, "user");
    if (user?.kind !== "user") {
      return;
    }
    const image = user.blocks.find((b) => b.type === "image");
    assert.ok(image, "expected image ContentBlock to survive inbound replace");
    assert.equal(image?.type, "image");
    if (image?.type === "image") {
      assert.equal(image.data, "abc123");
      assert.equal(image.mimeType, "image/png");
    }
    // Placeholder stripped from display text.
    const text = user.blocks.find((b) => b.type === "text");
    assert.equal(text?.type, "text");
    if (text?.type === "text") {
      assert.equal(text.text, "hi, see this image?");
      assert.doesNotMatch(text.text, /\[Image/i);
    }
  });

  it("keeps a user-locked catalog title over inbound session_info", () => {
    const local = createSessionState({ id: "s1", workspace: "/w" });
    local.title = "My name";
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "hello" }],
      },
    ];
    const inbound = createSessionState({ id: "s1", workspace: "/w" });
    inbound.title = "Agent generated title";
    inbound.timeline = local.timeline;
    const merged = mergeCanvasInbound(inbound, local, [
      { id: "s1", title: "My name", titleLocked: true },
    ]);
    assert.equal(merged.title, "My name");
  });
});

describe("preserveLocalUserMedia", () => {
  it("does not cross-session merge media from the painted canvas", () => {
    const local = createSessionState({ id: "canvas", workspace: "/w" });
    local.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [
          { type: "text", text: "hi" },
          { type: "image", mimeType: "image/png", data: "x" },
        ],
      },
    ];
    const inbound = createSessionState({ id: "background", workspace: "/w" });
    inbound.timeline = [
      {
        kind: "user",
        id: "u2",
        blocks: [{ type: "text", text: "hi" }],
      },
    ];
    const next = preserveLocalUserMedia(inbound, local);
    assert.equal(next, inbound);
    const user = next.timeline[0];
    assert.equal(user?.kind, "user");
    if (user?.kind === "user") {
      assert.equal(
        user.blocks.some((b) => b.type === "image"),
        false,
      );
    }
  });

  it("restores images on draft→forceNew handoff (empty local id)", () => {
    const local = createSessionState({ id: "", workspace: "/demo" });
    local.timeline = [
      {
        kind: "user",
        id: "local-u",
        blocks: [
          { type: "text", text: "pic" },
          { type: "image", mimeType: "image/png", data: "pngdata" },
        ],
        origin: "local",
        clientPromptId: "c9",
      },
    ];
    const inbound = createSessionState({ id: "new-sid", workspace: "/demo" });
    inbound.timeline = [
      {
        kind: "user",
        id: "echo",
        blocks: [{ type: "text", text: "[Image #1] pic" }],
      },
    ];
    const next = preserveLocalUserMedia(inbound, local);
    const user = next.timeline[0];
    assert.equal(user?.kind, "user");
    if (user?.kind !== "user") {
      return;
    }
    assert.ok(user.blocks.some((b) => b.type === "image"));
    assert.equal(user.clientPromptId, "c9");
  });

  it("matches media by body text when reduce bucket is shorter than canvas", () => {
    // Canvas has history + new optimistic image; inbound only has the new turn.
    const local = createSessionState({ id: "s1", workspace: "/demo" });
    local.timeline = [
      {
        kind: "user",
        id: "u0",
        blocks: [{ type: "text", text: "earlier" }],
      },
      { kind: "agent", id: "a0", text: "ok" },
      {
        kind: "user",
        id: "u1",
        blocks: [
          { type: "text", text: "new pic" },
          { type: "image", mimeType: "image/png", data: "zz" },
        ],
        origin: "local",
        clientPromptId: "c2",
      },
    ];
    const inbound = createSessionState({ id: "s1", workspace: "/demo" });
    inbound.timeline = [
      {
        kind: "user",
        id: "echo",
        blocks: [{ type: "text", text: "[Image #1]\nnew pic" }],
      },
      { kind: "agent", id: "a1", text: "got it" },
    ];
    const next = preserveLocalUserMedia(inbound, local);
    const user = next.timeline[0];
    assert.equal(user?.kind, "user");
    if (user?.kind !== "user") {
      return;
    }
    const image = user.blocks.find((b) => b.type === "image");
    assert.ok(image, "media must match second local user by text, not index 0");
    if (image?.type === "image") {
      assert.equal(image.data, "zz");
    }
  });
});
