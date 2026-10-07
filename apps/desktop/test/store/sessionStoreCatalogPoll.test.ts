/**
 * Idle rail refresh: skip while a turn is busy, read when idle.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CATALOG_REFRESH_IDLE_MS,
  catalogRefreshBusy,
  setCatalogRefreshHostForTests,
  startCatalogRefresh,
  stopCatalogRefresh,
} from "@/store/sessionStoreCatalogPoll";

afterEach(() => {
  stopCatalogRefresh();
  setCatalogRefreshHostForTests(null);
});

describe("catalogRefreshBusy", () => {
  it("is busy while the canvas or a live pool entry is streaming", () => {
    assert.equal(catalogRefreshBusy({ sessionStatus: "streaming" }), true);
    assert.equal(
      catalogRefreshBusy({ sessionStatus: "waiting_permission" }),
      true,
    );
    assert.equal(catalogRefreshBusy({ creatingSession: true }), true);
    assert.equal(
      catalogRefreshBusy({
        poolEntries: [{ live: true, status: "streaming" }],
      }),
      true,
    );
    assert.equal(
      catalogRefreshBusy({
        sessionStatus: "idle",
        poolEntries: [{ live: true, status: "idle" }],
      }),
      false,
    );
  });
});

describe("startCatalogRefresh", () => {
  it("uses a 10–15s interval and skips a busy tick", async () => {
    assert.ok(CATALOG_REFRESH_IDLE_MS >= 10_000);
    assert.ok(CATALOG_REFRESH_IDLE_MS <= 15_000);
    const timers: Array<{ fn: () => void; ms: number }> = [];
    setCatalogRefreshHostForTests({
      setInterval: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length as unknown as ReturnType<typeof setInterval>;
      },
      clearInterval: () => {
        /* dropped */
      },
    });
    let calls = 0;
    let busy = true;
    startCatalogRefresh(
      async () => {
        calls += 1;
      },
      () => busy,
    );
    assert.equal(timers.length, 1);
    assert.equal(timers[0]?.ms, CATALOG_REFRESH_IDLE_MS);
    timers[0]?.fn();
    await Promise.resolve();
    assert.equal(calls, 0);
    busy = false;
    timers[0]?.fn();
    await Promise.resolve();
    assert.equal(calls, 1);
  });
});
