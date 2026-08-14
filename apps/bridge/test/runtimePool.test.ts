/**
 * RuntimePool pure-logic unit tests: idle LRU reclaim / busy waits for room.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isIdleStatus,
  pickLruIdleVictim,
  RuntimePool,
  type PooledRuntime,
} from "../src/runtimePool.js";
import type { SessionState, SessionStatus } from "@grok-desktop/acp-core";

/** Build a minimal fake runtime; status can mutate via the returned box. */
function fakeRuntime(
  id: string,
  status: SessionStatus,
  lastUsed: number,
  disposed: string[],
  statusBox?: { status: SessionStatus },
): PooledRuntime {
  const box = statusBox ?? { status };
  const state = {
    id,
    workspace: "/tmp",
    model: "",
    mode: "build" as const,
    status: box.status,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  } satisfies SessionState;
  return {
    sessionId: id,
    cwd: "/tmp",
    lastUsed,
    getStatus: () => box.status,
    getSessionState: () => ({ ...state, status: box.status }),
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
  it("beginSpawn reserves capacity so concurrent starts cannot overshoot", async () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(1);
    await pool.beginSpawn();
    // Second begin blocks until the first reservation is consumed and idle is reclaimable.
    let secondResolved = false;
    const second = pool.beginSpawn().then(() => {
      secondResolved = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(secondResolved, false);
    await pool.insert(fakeRuntime("a", "idle", 10, disposed));
    await second;
    await pool.insert(fakeRuntime("b", "idle", 20, disposed));
    assert.equal(pool.size, 1);
    assert.ok(disposed.includes("a"));
  });

  it("cancelSpawn releases a reservation without insert", async () => {
    const pool = new RuntimePool(1);
    await pool.beginSpawn();
    pool.cancelSpawn();
    // Second begin must succeed once the first reservation is cancelled.
    await pool.beginSpawn();
    pool.cancelSpawn();
  });

  it("evicts idle LRU when at capacity", async () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(2);
    await pool.insert(fakeRuntime("a", "idle", 10, disposed));
    await pool.insert(fakeRuntime("b", "idle", 20, disposed));
    pool.touch("a");
    await pool.insert(fakeRuntime("c", "idle", 30, disposed));
    // b is oldest idle after touch(a)
    assert.ok(disposed.includes("b"));
    assert.equal(pool.has("a"), true);
    assert.equal(pool.has("c"), true);
    assert.equal(pool.has("b"), false);
  });

  it("waits when full and all busy until a session becomes idle", async () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(1);
    const statusBox = { status: "streaming" as SessionStatus };
    await pool.insert(fakeRuntime("busy", "streaming", 1, disposed, statusBox));

    let inserted = false;
    const pending = pool.insert(fakeRuntime("next", "idle", 2, disposed)).then(() => {
      inserted = true;
    });
    // Still busy: insert must wait (not throw).
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(inserted, false);
    assert.equal(pool.has("busy"), true);

    // Become idle so reclaim can free the slot.
    statusBox.status = "idle";
    await pending;
    assert.equal(inserted, true);
    assert.ok(disposed.includes("busy"));
    assert.equal(pool.has("next"), true);
  });

  it("waits when full until close frees a slot", async () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(1);
    await pool.insert(fakeRuntime("busy", "streaming", 1, disposed));

    let reserved = false;
    const pending = pool.beginSpawn().then(() => {
      reserved = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(reserved, false);

    pool.close("busy");
    await pending;
    assert.equal(reserved, true);
    pool.cancelSpawn();
  });

  it("disposeAll unblocks waiters with a disposed error", async () => {
    const disposed: string[] = [];
    const pool = new RuntimePool(1);
    await pool.insert(fakeRuntime("busy", "streaming", 1, disposed));

    const pending = pool.beginSpawn();
    await new Promise((r) => setTimeout(r, 50));
    pool.disposeAll();
    await assert.rejects(pending, /disposed/i);
    assert.ok(disposed.includes("busy"));
  });
});
