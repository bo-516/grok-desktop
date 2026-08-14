/**
 * Auto-reconnect cadence: 3s interval, in-flight drop, draft-safe resume plan.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRIDGE_RECONNECT_MS,
  resolveAutoReconnectStart,
  shouldArmBridgeReconnect,
  startBridgeReconnectLoop,
} from "@/lib/bridgeReconnect";
import { readSrc } from "../helpers/sourceFiles.js";

/**
 * Fake interval host that records the pending tick and lets tests fire it.
 * @returns Timers matching BridgeReconnectTimers plus inspect / fire helpers.
 */
function makeFakeTimers() {
  const intervals = new Map<
    number,
    { handler: () => void; ms: number }
  >();
  let nextId = 1;
  return {
    intervals,
    setInterval: (handler: () => void, ms: number) => {
      const id = nextId;
      nextId += 1;
      intervals.set(id, { handler, ms });
      return id;
    },
    clearInterval: (id: number) => {
      intervals.delete(id);
    },
    /** Delay of the single pending interval, or undefined when none is armed. */
    pendingMs: () => [...intervals.values()][0]?.ms,
    /** Fire the pending tick and flush the attempt promise chain. */
    fire: async () => {
      const entry = [...intervals.values()][0];
      if (!entry) {
        return;
      }
      entry.handler();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("bridge reconnect cadence", () => {
  it("retries every 3 seconds and only while disconnected", () => {
    assert.equal(BRIDGE_RECONNECT_MS, 3_000);
    assert.equal(shouldArmBridgeReconnect("disconnected"), true);
    assert.equal(shouldArmBridgeReconnect("connecting"), false);
    assert.equal(shouldArmBridgeReconnect("live-bridge"), false);
  });

  it("does not fire immediately; first tick is the 3s retry", async () => {
    const timers = makeFakeTimers();
    let calls = 0;
    const stop = startBridgeReconnectLoop(async () => {
      calls += 1;
    }, timers);
    assert.equal(calls, 0);
    assert.equal(timers.pendingMs(), BRIDGE_RECONNECT_MS);
    await timers.fire();
    assert.equal(calls, 1);
    stop();
    assert.equal(timers.intervals.size, 0);
  });

  it("drops overlapping ticks while an attempt is in flight", async () => {
    const timers = makeFakeTimers();
    let started = 0;
    let release: (() => void) | undefined;
    const stop = startBridgeReconnectLoop(
      () =>
        new Promise<void>((resolve) => {
          started += 1;
          release = resolve;
        }),
      timers,
    );
    timers.intervals.values().next().value?.handler();
    timers.intervals.values().next().value?.handler();
    await Promise.resolve();
    assert.equal(started, 1);
    release?.();
    await Promise.resolve();
    stop();
  });

  it("swallows a rejected attempt so the next tick can run", async () => {
    const timers = makeFakeTimers();
    let calls = 0;
    const stop = startBridgeReconnectLoop(async () => {
      calls += 1;
      throw new Error("bridge down");
    }, timers);
    await timers.fire();
    await timers.fire();
    assert.equal(calls, 2);
    stop();
  });
});

describe("resolveAutoReconnectStart", () => {
  it("resumes the viewing session when one is selected", () => {
    assert.deepEqual(
      resolveAutoReconnectStart({
        viewingSessionId: "view-1",
        sessionId: "canvas-2",
        localDraft: false,
        catalogId: "cat-3",
      }),
      { connectOnly: false, resumeId: "view-1" },
    );
  });

  it("resumes the painted canvas when viewing is empty", () => {
    assert.deepEqual(
      resolveAutoReconnectStart({
        viewingSessionId: null,
        sessionId: "canvas-2",
        localDraft: false,
        catalogId: "cat-3",
      }),
      { connectOnly: false, resumeId: "canvas-2" },
    );
  });

  it("does not steal catalog[0] from a New chat draft", () => {
    assert.deepEqual(
      resolveAutoReconnectStart({
        viewingSessionId: null,
        sessionId: "",
        localDraft: true,
        catalogId: "cat-3",
      }),
      { connectOnly: true },
    );
  });

  it("resumes catalog[0] when idle and not drafting", () => {
    assert.deepEqual(
      resolveAutoReconnectStart({
        viewingSessionId: "",
        sessionId: "",
        localDraft: false,
        catalogId: "cat-3",
      }),
      { connectOnly: false, resumeId: "cat-3" },
    );
  });

  it("connects only when there is nothing to resume", () => {
    assert.deepEqual(
      resolveAutoReconnectStart({
        viewingSessionId: null,
        sessionId: "",
        localDraft: false,
      }),
      { connectOnly: true },
    );
  });
});

describe("bridge reconnect wiring", () => {
  it("shell lifecycle arms the 3s loop via ensureConnected", () => {
    const lifecycle = readSrc("widgets/shell/useShellSessionLifecycle.ts");
    assert.match(lifecycle, /shouldArmBridgeReconnect/);
    assert.match(lifecycle, /startBridgeReconnectLoop/);
    assert.match(
      lifecycle,
      /startBridgeReconnectLoop\(\s*\(\) => ensureConnected\(\)/,
    );
  });

  it("offline banner tells the user it retries every 3s", () => {
    const banners = readSrc("widgets/shell/ShellBannersView.tsx");
    assert.match(banners, /Retrying every 3s/);
    assert.match(banners, /npm run bridge/);
  });

  it("startLiveBridgeSession honors connectOnly (no session/start)", () => {
    const live = readSrc("store/sessionStoreLive.ts");
    assert.match(live, /connectOnly/);
    assert.match(live, /live · connected/);
  });
});
