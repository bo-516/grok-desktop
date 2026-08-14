/**
 * Weekly remaining refresh: parses `_x.ai/billing`, keeps last-known-good, and
 * reports the ok / fail / skip outcome the composer poll paces on.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionBillingSnapshot } from "@grok-desktop/acp-core";
import { refreshWeeklyUsageAction } from "@/store/sessionStoreBilling";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
} from "@/store/sessionStoreTypes";

/**
 * Store double for weekly remaining refresh.
 * @param opts Connection, session id, billing RPC, and last-known snapshot.
 */
function makeHarness(opts: {
  connectionMode?: SessionStore["connectionMode"];
  sessionId?: string;
  billing?: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  weeklyUsage?: SessionBillingSnapshot | null;
}) {
  let state = {
    connectionMode: opts.connectionMode ?? "live-bridge",
    session: { id: opts.sessionId ?? "s1" },
    activeSessionId: opts.sessionId ?? "s1",
    viewingSessionId: opts.sessionId ?? "s1",
    weeklyUsage: opts.weeklyUsage ?? null,
    live: opts.billing
      ? { billing: opts.billing }
      : { billing: async () => ({ ok: true, data: { config: {} } }) },
  } as unknown as SessionStore;

  const set: SessionStoreSet = (partialOrFn) => {
    const patch =
      typeof partialOrFn === "function" ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...patch };
  };
  const get: SessionStoreGet = () => state;
  return { set, get, read: () => state };
}

describe("refreshWeeklyUsageAction", () => {
  it("stores a parsed weekly snapshot from billing data", async () => {
    const h = makeHarness({
      billing: async () => ({
        ok: true,
        data: {
          config: {
            creditUsagePercent: 92,
            currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
          },
        },
      }),
    });
    assert.equal(await refreshWeeklyUsageAction(h.set, h.get), "ok");
    const snap = h.read().weeklyUsage;
    assert.ok(snap);
    assert.equal(snap.remainingPercent, 8);
    assert.equal(snap.periodKind, "weekly");
  });

  it("keeps last-known-good when the bag cannot be parsed", async () => {
    const prior: SessionBillingSnapshot = {
      usagePercent: 10,
      remainingPercent: 90,
      periodKind: "weekly",
      usageLabel: "Weekly limit",
      payAsYouGo: false,
    };
    const h = makeHarness({
      weeklyUsage: prior,
      billing: async () => ({ ok: true, data: { config: {} } }),
    });
    assert.equal(await refreshWeeklyUsageAction(h.set, h.get), "fail");
    assert.equal(h.read().weeklyUsage, prior);
  });

  it("no-ops when the bridge is disconnected", async () => {
    let called = false;
    const h = makeHarness({
      connectionMode: "disconnected",
      billing: async () => {
        called = true;
        return { ok: true, data: {} };
      },
    });
    assert.equal(await refreshWeeklyUsageAction(h.set, h.get), "skip");
    assert.equal(called, false);
    assert.equal(h.read().weeklyUsage, null);
  });

  it("no-ops without a resident session id", async () => {
    let called = false;
    const h = makeHarness({
      sessionId: "",
      billing: async () => {
        called = true;
        return { ok: true, data: {} };
      },
    });
    assert.equal(await refreshWeeklyUsageAction(h.set, h.get), "skip");
    assert.equal(called, false);
  });

  it("keeps last-known-good when the RPC fails", async () => {
    const prior: SessionBillingSnapshot = {
      usagePercent: 10,
      remainingPercent: 90,
      periodKind: "weekly",
      usageLabel: "Weekly limit",
      payAsYouGo: false,
    };
    const h = makeHarness({
      weeklyUsage: prior,
      billing: async () => ({ ok: false, error: "method not found" }),
    });
    assert.equal(await refreshWeeklyUsageAction(h.set, h.get), "fail");
    assert.equal(h.read().weeklyUsage, prior);
  });

  it("does not stack overlapping refreshes", async () => {
    let calls = 0;
    const h = makeHarness({
      billing: async () => {
        calls += 1;
        await new Promise((resolve) => {
          setTimeout(resolve, 40);
        });
        return {
          ok: true,
          data: {
            config: {
              creditUsagePercent: 10,
              currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
            },
          },
        };
      },
    });
    const outcomes = await Promise.all([
      refreshWeeklyUsageAction(h.set, h.get),
      refreshWeeklyUsageAction(h.set, h.get),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(outcomes, ["ok", "skip"]);
  });
});
