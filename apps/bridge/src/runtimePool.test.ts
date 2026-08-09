/**
 * RuntimePool pure-logic unit tests: idle LRU reclaim / busy not reclaimed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isIdleStatus,
  pickLruIdleVictim,
  RuntimePool,
  type PooledRuntime,
} from "./runtimePool.js";
import type { SessionState, SessionStatus } from "@grok-desktop/acp-core";

/** Build a minimal fake runtime. */
function fakeRuntime(
  id: string,
  status: SessionStatus,
  lastUsed: number,
  disposed: string[],
): PooledRuntime {
  const state = {
    id,
    workspace: "/tmp",
    model: "",
    mode: "build" as const,
    status,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  } satisfies SessionState;
  return {
    sessionId: id,
    cwd: "/tmp",
    lastUsed,
    getStatus: () => status,
    getSessionState: () => state,
    prompt: async () => undefined,
    cancel: () => undefined,
    respondPermission: () => undefined,
    dispose: () => {
      disposed.push(id);
    },
  };
}

describe("isIdleStatus", () => {
  it("treats idle and disconnected as reclaimable", () => {
    assert.equal(isIdleStatus("idle"), true);
    assert.equal(isIdleStatus("disconnected"), true);
    assert.equal(isIdleStatus("streaming"), false);
    assert.equal(isIdleStatus("waiting_permission"), false);
  });
});

describe("pickLruIdleVictim", () => {
  it("picks oldest idle and skips busy", () => {
    const victim = pickLruIdleVictim([
      { sessionId: "busy", lastUsed: 1, status: "streaming" },
      { sessionId: "old-idle", lastUsed: 2, status: "idle" },
      { sessionId: "new-idle", lastUsed: 9, status: "idle" },
    ]);
    assert.equal(victim, "old-idle");
  });

  it("returns null when all busy", () => {
    const victim = pickLruIdleVictim([
      { sessionId: "a", lastUsed: 1, status: "streaming" },
      { sessionId: "b", lastUsed: 2, status: "waiting_permission" },
    ]);
    assert.equal(victim, null);
  });
});

describe("RuntimePool", () => {
  it("evicts idle LRU when at capacity", () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(2);
    pool.insert(fakeRuntime("a", "idle", 10, disposed));
    pool.insert(fakeRuntime("b", "idle", 20, disposed));
    pool.touch("a");
    pool.insert(fakeRuntime("c", "idle", 30, disposed));
    // b is oldest idle after touch(a)
    assert.ok(disposed.includes("b"));
    assert.equal(pool.has("a"), true);
    assert.equal(pool.has("c"), true);
    assert.equal(pool.has("b"), false);
  });

  it("throws when full and all busy", () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(1);
    pool.insert(fakeRuntime("busy", "streaming", 1, disposed));
    assert.throws(
      () => pool.insert(fakeRuntime("next", "idle", 2, disposed)),
      /full/,
    );
    assert.equal(disposed.length, 0);
    assert.equal(pool.has("busy"), true);
  });
});
