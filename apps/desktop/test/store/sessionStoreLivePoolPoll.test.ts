/**
 * Pool poll helpers for footer "N running" (streaming-only; 1s list_pool while live).
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import {
  POOL_POLL_MS,
  applyPoolBusyToSession,
  startPoolPoll,
  stopPoolPoll,
} from "../../src/store/sessionStoreLive";
import { resolveResumeCanvasStatus } from "../../src/store/sessionStoreSupport";

describe("sessionStoreLive pool poll", () => {
  afterEach(() => {
    stopPoolPoll();
  });

  it("POOL_POLL_MS is 1 second", () => {
    assert.equal(POOL_POLL_MS, 1000);
  });

  it("startPoolPoll invokes listPool on the interval and stopPoolPoll ends it", async () => {
    let calls = 0;
    startPoolPoll(() => {
      calls += 1;
      return true;
    });
    assert.equal(calls, 0, "poll should not fire synchronously");
    await new Promise((r) => setTimeout(r, POOL_POLL_MS + 80));
    assert.ok(calls >= 1, `expected ≥1 listPool call, got ${calls}`);
    const atStop = calls;
    stopPoolPoll();
    await new Promise((r) => setTimeout(r, POOL_POLL_MS + 80));
    assert.equal(calls, atStop, "no further calls after stopPoolPoll");
  });

  it("startPoolPoll restarts cleanly (no double intervals)", async () => {
    let calls = 0;
    startPoolPoll(() => {
      calls += 1;
      return true;
    });
    startPoolPoll(() => {
      calls += 1;
      return true;
    });
    await new Promise((r) => setTimeout(r, POOL_POLL_MS + 80));
    // One interval only: roughly 1 tick in ~1.08s window (allow 1–2).
    assert.ok(calls >= 1 && calls <= 2, `expected 1–2 calls, got ${calls}`);
  });
});

describe("applyPoolBusyToSession", () => {
  it("promotes idle canvas to streaming when the viewed pool row is busy", () => {
    const session = createSessionState({ id: "s1", workspace: "/w" });
    const next = applyPoolBusyToSession(session, "s1", [
      {
        sessionId: "s1",
        cwd: "/w",
        status: "streaming",
        lastUsed: 1,
        live: true,
      },
    ]);
    assert.equal(next.status, "streaming");
    assert.notEqual(next, session);
  });

  it("does not demote a streaming canvas when the pool row is idle", () => {
    const session = {
      ...createSessionState({ id: "s1", workspace: "/w" }),
      status: "streaming" as const,
    };
    const next = applyPoolBusyToSession(session, "s1", [
      {
        sessionId: "s1",
        cwd: "/w",
        status: "idle",
        lastUsed: 1,
        live: true,
      },
    ]);
    assert.equal(next, session);
    assert.equal(next.status, "streaming");
  });

  it("ignores pool rows for a different session", () => {
    const session = createSessionState({ id: "s1", workspace: "/w" });
    const next = applyPoolBusyToSession(session, "s1", [
      {
        sessionId: "other",
        cwd: "/w",
        status: "streaming",
        lastUsed: 1,
        live: true,
      },
    ]);
    assert.equal(next, session);
  });

  it("does not promote Working while the viewed session is restoring", () => {
    const session = createSessionState({ id: "s1", workspace: "/w" });
    const next = applyPoolBusyToSession(
      session,
      "s1",
      [
        {
          sessionId: "s1",
          cwd: "/w",
          status: "streaming",
          lastUsed: 1,
          live: true,
        },
      ],
      "s1",
    );
    assert.equal(next, session);
    assert.equal(next.status, "idle");
  });
});

describe("resolveResumeCanvasStatus", () => {
  it("keeps pool streaming over an idle seed", () => {
    assert.equal(resolveResumeCanvasStatus("idle", "streaming"), "streaming");
  });

  it("drops stale seed streaming once the pool is listed idle", () => {
    assert.equal(resolveResumeCanvasStatus("streaming", "idle"), "idle");
  });

  it("keeps seed streaming when the pool snapshot is not in yet", () => {
    assert.equal(resolveResumeCanvasStatus("streaming", undefined), "streaming");
  });
});
