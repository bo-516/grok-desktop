/**
 * Composer-ring occupancy backfill after session/load drops stamps.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import { resetCatalogPersistHooksForTests } from "@/store/catalogPersistQueue";
import {
  applyTokenUsageToStore,
  needsOccupancyBackfill,
  refreshSessionTokenUsageAction,
  resetTokenUsageBackfill,
  scheduleTokenUsageBackfill,
  syncTokenUsageBackfillFromInbound,
} from "@/store/sessionStoreTokenUsage";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
} from "@/store/sessionStoreTypes";

afterEach(() => {
  resetCatalogPersistHooksForTests();
  resetTokenUsageBackfill("s1");
  resetTokenUsageBackfill("canvas");
  resetTokenUsageBackfill("other");
  resetTokenUsageBackfill("sess-a");
  resetTokenUsageBackfill("sess-b");
  resetTokenUsageBackfill("missing");
});

/**
 * Store double for occupancy backfill. Canvas id defaults to s1.
 * @param opts Connection, occupancy, and tokenUsage RPC override.
 */
function makeHarness(opts: {
  connectionMode?: SessionStore["connectionMode"];
  sessionId?: string;
  tokenUsage?: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  occupancy?: number;
}) {
  const session = createSessionState({
    id: opts.sessionId ?? "s1",
    workspace: "/w",
  });
  if (opts.occupancy != null) {
    session.tokenUsage = {
      inputTokens: opts.occupancy,
      outputTokens: 0,
      totalTokens: opts.occupancy,
      contextTokensUsed: opts.occupancy,
    };
  }
  let state = {
    connectionMode: opts.connectionMode ?? "live-bridge",
    session,
    catalog: [],
    activeSessionId: opts.sessionId ?? "s1",
    viewingSessionId: opts.sessionId ?? "s1",
    live: opts.tokenUsage
      ? { tokenUsage: opts.tokenUsage }
      : {
          tokenUsage: async () => ({
            ok: true,
            data: { contextTokensUsed: 137_217 },
          }),
        },
  } as unknown as SessionStore;

  const set: SessionStoreSet = (partialOrFn) => {
    const patch =
      typeof partialOrFn === "function" ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...patch };
  };
  const get: SessionStoreGet = () => state;
  return { set, get, read: () => state };
}

describe("needsOccupancyBackfill", () => {
  it("is true until live occupancy is present", () => {
    assert.equal(needsOccupancyBackfill(undefined), true);
    assert.equal(
      needsOccupancyBackfill({
        inputTokens: 100,
        outputTokens: 1,
        totalTokens: 101,
      }),
      true,
    );
    assert.equal(
      needsOccupancyBackfill({
        inputTokens: 100,
        outputTokens: 1,
        totalTokens: 101,
        contextTokensUsed: 80_000,
      }),
      false,
    );
  });
});

describe("refreshSessionTokenUsageAction", () => {
  it("writes occupancy onto the canvas session", async () => {
    const h = makeHarness({
      tokenUsage: async () => ({
        ok: true,
        data: { used: 137_217 },
      }),
    });
    resetTokenUsageBackfill("s1");
    await refreshSessionTokenUsageAction(h.set, h.get, "s1");
    assert.equal(h.read().session.tokenUsage?.contextTokensUsed, 137_217);
  });

  it("no-ops when disconnected", async () => {
    let called = false;
    const h = makeHarness({
      connectionMode: "disconnected",
      tokenUsage: async () => {
        called = true;
        return { ok: true, data: { used: 1 } };
      },
    });
    await refreshSessionTokenUsageAction(h.set, h.get, "s1");
    assert.equal(called, false);
    assert.equal(h.read().session.tokenUsage, undefined);
  });
});

describe("applyTokenUsageToStore", () => {
  it("merges occupancy onto billed canvas usage", () => {
    const h = makeHarness({});
    h.read().session.tokenUsage = {
      inputTokens: 4_000_000,
      outputTokens: 10,
      totalTokens: 4_000_010,
    };
    applyTokenUsageToStore(h.set, h.get, "s1", {
      inputTokens: 137_217,
      outputTokens: 0,
      totalTokens: 137_217,
      contextTokensUsed: 137_217,
    });
    assert.equal(h.read().session.tokenUsage?.contextTokensUsed, 137_217);
    assert.equal(h.read().session.tokenUsage?.inputTokens, 4_000_000);
  });

  it("writes occupancy onto a catalog row that is not the canvas", () => {
    const h = makeHarness({ sessionId: "canvas" });
    const other = createSessionState({ id: "other", workspace: "/w" });
    other.title = "Other";
    other.timeline = [
      { id: "u", kind: "user", blocks: [{ type: "text", text: "hi" }] },
    ];
    other.tokenUsage = {
      inputTokens: 9,
      outputTokens: 1,
      totalTokens: 10,
    };
    const rec = {
      id: "other",
      workspace: "/w",
      title: "Other",
      mode: "build" as const,
      model: "",
      status: "idle" as const,
      createdAt: 1,
      updatedAt: 2,
      timeline: other.timeline,
      toolCalls: {},
      lastAgentText: "",
      tokenUsage: other.tokenUsage,
    };
    h.read().catalog = [rec];
    applyTokenUsageToStore(h.set, h.get, "other", {
      inputTokens: 50_000,
      outputTokens: 0,
      totalTokens: 50_000,
      contextTokensUsed: 50_000,
    });
    assert.equal(h.read().session.id, "canvas");
    assert.equal(h.read().catalog[0]?.tokenUsage?.contextTokensUsed, 50_000);
    assert.equal(h.read().catalog[0]?.tokenUsage?.inputTokens, 9);
  });

  it("patches only tokenUsage on a non-canvas row (plan/title/subagents/goal stay)", () => {
    const h = makeHarness({ sessionId: "sess-a" });
    const canvasPlan = [{ id: "a-step", content: "canvas plan" }];
    const canvasSubs = {
      worker: {
        subagentId: "worker",
        childSessionId: "child-a",
        type: "general-purpose",
        description: "canvas worker",
        status: "running",
      },
    };
    const canvasGoal = { title: "canvas goal", status: "active" };
    h.read().session.plan = canvasPlan as never;
    h.read().session.title = "Canvas A";
    h.read().session.subagents = canvasSubs as never;
    h.read().session.goal = canvasGoal as never;

    const bPlan = [{ id: "b-step", content: "row B plan" }];
    const bSubs = {
      other: {
        subagentId: "other",
        childSessionId: "child-b",
        type: "explore",
        description: "row B worker",
        status: "completed",
      },
    };
    const bGoal = { title: "row B goal", status: "done" };
    const rowA = {
      id: "sess-a",
      workspace: "/w",
      title: "Canvas A",
      mode: "build" as const,
      model: "grok-a",
      status: "idle" as const,
      createdAt: 1,
      updatedAt: 10,
      timeline: [],
      toolCalls: {},
      lastAgentText: "",
    };
    const rowB = {
      id: "sess-b",
      workspace: "/w",
      title: "Row B",
      mode: "build" as const,
      model: "grok-b",
      status: "idle" as const,
      createdAt: 2,
      updatedAt: 20,
      timeline: [],
      toolCalls: {},
      lastAgentText: "",
      plan: bPlan,
      subagents: bSubs,
      goal: bGoal,
    };
    h.read().catalog = [rowA, rowB] as never;
    applyTokenUsageToStore(h.set, h.get, "sess-b", {
      inputTokens: 12,
      outputTokens: 0,
      totalTokens: 12,
      contextTokensUsed: 12,
    });
    const after = h.read().catalog;
    assert.equal(after[0]?.id, "sess-a");
    assert.equal(after[1]?.id, "sess-b");
    assert.equal(after[1]?.updatedAt, 20);
    assert.equal(after[1]?.plan, bPlan);
    assert.equal(after[1]?.subagents, bSubs);
    assert.equal(after[1]?.goal, bGoal);
    assert.equal(after[1]?.title, "Row B");
    assert.equal(after[1]?.tokenUsage?.contextTokensUsed, 12);
  });

  it("does not call set when the catalog row is missing", () => {
    const h = makeHarness({ sessionId: "canvas" });
    let setCalls = 0;
    const set: SessionStoreSet = (partialOrFn) => {
      setCalls += 1;
      h.set(partialOrFn);
    };
    applyTokenUsageToStore(set, h.get, "missing", {
      inputTokens: 1,
      outputTokens: 0,
      totalTokens: 1,
      contextTokensUsed: 1,
    });
    assert.equal(setCalls, 0);
    assert.equal(h.read().catalog.length, 0);
  });
});

describe("scheduleTokenUsageBackfill", () => {
  it("is one-shot until the latch is reset", async () => {
    let calls = 0;
    const h = makeHarness({
      tokenUsage: async () => {
        calls += 1;
        return { ok: true, data: { used: 10 } };
      },
    });
    resetTokenUsageBackfill("s1");
    scheduleTokenUsageBackfill(h.set, h.get, "s1");
    scheduleTokenUsageBackfill(h.set, h.get, "s1");
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    assert.equal(calls, 1);
  });
});

describe("syncTokenUsageBackfillFromInbound", () => {
  it("arms occupancy backfill on a live attach with no usage yet", async () => {
    let calls = 0;
    const h = makeHarness({
      tokenUsage: async () => {
        calls += 1;
        return { ok: true, data: { used: 11 } };
      },
    });
    resetTokenUsageBackfill("s1");
    syncTokenUsageBackfillFromInbound(h.set, h.get, {
      sessionId: "s1",
      status: "streaming",
      follow: true,
      restoreDone: false,
      tokenUsage: undefined,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    assert.equal(calls, 1);
  });

  it("resets the latch once occupancy exists so a later idle can refresh", async () => {
    let calls = 0;
    const h = makeHarness({
      occupancy: 80_000,
      tokenUsage: async () => {
        calls += 1;
        return { ok: true, data: { used: 11 } };
      },
    });
    resetTokenUsageBackfill("s1");
    syncTokenUsageBackfillFromInbound(h.set, h.get, {
      sessionId: "s1",
      status: "streaming",
      follow: true,
      restoreDone: false,
      tokenUsage: h.read().session.tokenUsage,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    assert.equal(calls, 0);

    // Drop occupancy to simulate compact; idle follow should re-arm.
    h.read().session.tokenUsage = undefined;
    syncTokenUsageBackfillFromInbound(h.set, h.get, {
      sessionId: "s1",
      status: "idle",
      follow: true,
      restoreDone: false,
      tokenUsage: undefined,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    assert.equal(calls, 1);
  });

  it("keeps only the later request when two RPCs overlap (first resolves last)", async () => {
    const deferred: Array<{
      used: number;
      resolve: (value: { ok: boolean; data: { used: number } }) => void;
    }> = [];
    const h = makeHarness({
      sessionId: "sess-a",
      tokenUsage: () =>
        new Promise((resolve) => {
          deferred.push({
            used: deferred.length === 0 ? 100 : 200,
            resolve: resolve as (value: {
              ok: boolean;
              data: { used: number };
            }) => void,
          });
        }),
    });
    const rowB = {
      id: "sess-b",
      workspace: "/w",
      title: "B",
      mode: "build" as const,
      model: "",
      status: "idle" as const,
      createdAt: 1,
      updatedAt: 2,
      timeline: [],
      toolCalls: {},
      lastAgentText: "",
    };
    h.read().catalog = [rowB];
    const first = refreshSessionTokenUsageAction(h.set, h.get, "sess-b");
    const second = refreshSessionTokenUsageAction(h.set, h.get, "sess-b");
    assert.equal(deferred.length, 2);
    deferred[1]?.resolve({ ok: true, data: { used: 200 } });
    await second;
    deferred[0]?.resolve({ ok: true, data: { used: 100 } });
    await first;
    assert.equal(h.read().catalog[0]?.tokenUsage?.contextTokensUsed, 200);
  });

  it("refresh no-ops on an empty session id or a failed RPC", async () => {
    let called = false;
    const h = makeHarness({
      tokenUsage: async () => {
        called = true;
        return { ok: false, error: "missing" };
      },
    });
    await refreshSessionTokenUsageAction(h.set, h.get, "   ");
    assert.equal(called, false);
    resetTokenUsageBackfill("s1");
    await refreshSessionTokenUsageAction(h.set, h.get, "s1");
    assert.equal(called, true);
    assert.equal(h.read().session.tokenUsage, undefined);
  });
});
