/**
 * Catalog write churn + pool shallow equality + adaptive poll intervals.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  POOL_POLL_ACTIVE_MS,
  POOL_POLL_IDLE_MS,
  poolEntriesFingerprint,
  poolHasStreaming,
  startPoolPoll,
  stopPoolPoll,
} from "@/store/sessionStoreLive";
import { catalogRefsEqual } from "@/store/sessionCatalogUpsert";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import {
  loadFanoutOrders,
  replayFanOut,
  resolveOrderFrames,
} from "../helpers/fanoutProbe.js";

describe("catalog churn reductions", () => {
  afterEach(() => {
    stopPoolPoll();
  });

  it("child-only frames (content-stable rail) produce 0 catalog identity writes", () => {
    const meta = loadFanoutOrders();
    // Only child session frames — parent already stamped + seeded in probe.
    // Whitelist must keep catalog array identity stable for the whole run.
    const childOnly = resolveOrderFrames(
      meta,
      meta.orders.B.frames.filter((ref) => ref.startsWith("c:")),
    );
    assert.ok(childOnly.length >= 10, "fixture has child frames");
    const probe = replayFanOut(childOnly, { meta });
    assert.equal(
      probe.pollutedFrames,
      0,
      "child-only must not pollute rail",
    );
    // Doc bar: fewer than 5 content-changing catalog writes when content is stable.
    assert.ok(
      probe.catalogWrites < 5,
      `child-only catalogWrites=${probe.catalogWrites} (bar < 5; pre-fix ~31–47 for full fanout)`,
    );
    assert.equal(
      probe.catalogWrites,
      0,
      "isolated child frames must not rewrite catalog at all",
    );
  });

  it("full order B writes stay below pre-fix peak (parent frames still upsert)", () => {
    const meta = loadFanoutOrders();
    const frames = resolveOrderFrames(meta, meta.orders.B.frames);
    const probe = replayFanOut(frames, { meta });
    // Parent streaming still upserts; child isolation removes ~16 writes.
    assert.ok(
      probe.catalogWrites < 40,
      `catalogWrites=${probe.catalogWrites}`,
    );
    assert.equal(probe.pollutedFrames, 0);
  });

  it("catalogRefsEqual detects same row references", () => {
    const a: SessionRecord[] = [
      {
        id: "1",
        workspace: "/w",
        title: "t",
        mode: "build",
        model: "",
        status: "idle",
        createdAt: 1,
        updatedAt: 1,
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
    ];
    const b = [a[0]!];
    assert.equal(catalogRefsEqual(a, b), true);
    assert.equal(catalogRefsEqual(a, [{ ...a[0]! }]), false);
  });

  it("pool fingerprint equal when status tuple unchanged", () => {
    const e1 = [
      {
        sessionId: "s1",
        status: "streaming" as const,
        live: true,
        cwd: "/w",
        lastUsed: 1,
      },
    ];
    const e2 = [
      {
        sessionId: "s1",
        status: "streaming" as const,
        live: true,
        cwd: "/other",
        lastUsed: 99,
      },
    ];
    assert.equal(poolEntriesFingerprint(e1), poolEntriesFingerprint(e2));
    const e3 = [
      {
        sessionId: "s1",
        status: "idle" as const,
        live: true,
        cwd: "/w",
        lastUsed: 1,
      },
    ];
    assert.notEqual(poolEntriesFingerprint(e1), poolEntriesFingerprint(e3));
  });

  it("poolHasStreaming and adaptive intervals", () => {
    assert.equal(POOL_POLL_ACTIVE_MS, 1000);
    assert.equal(POOL_POLL_IDLE_MS, 5000);
    assert.ok(POOL_POLL_IDLE_MS > POOL_POLL_ACTIVE_MS);
    assert.equal(
      poolHasStreaming([
        {
          sessionId: "s",
          status: "streaming",
          live: true,
          cwd: "",
          lastUsed: 0,
        },
      ]),
      true,
    );
    assert.equal(
      poolHasStreaming([
        { sessionId: "s", status: "idle", live: true, cwd: "", lastUsed: 0 },
      ]),
      false,
    );
  });

  it("startPoolPoll uses active interval by default", async () => {
    let calls = 0;
    startPoolPoll(() => {
      calls += 1;
      return true;
    });
    await new Promise((r) => setTimeout(r, POOL_POLL_ACTIVE_MS + 80));
    assert.ok(calls >= 1);
    stopPoolPoll();
  });
});
