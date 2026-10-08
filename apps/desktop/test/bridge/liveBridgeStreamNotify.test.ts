/**
 * Before/after store-notification counts for live streaming through the
 * shipped dispatch → applyLiveInboundSession → zustand path, plus parity
 * (same final text / status) and settle hooks firing exactly once.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runStreamNotifyProbe,
  type StreamProbeOpts,
} from "../helpers/streamNotifyProbe.js";

/**
 * Scenarios: K sessions × N chunks at a fixed per-session wire spacing
 * (5 ms ≈ 200 chunks/s, 1 ms ≈ a burst). `minRatio` is the asserted
 * before/after floor, kept below the measured ratio so timing tweaks do not flake.
 */
const SCENARIOS: Array<
  Omit<StreamProbeOpts, "label" | "coalesce"> & { minRatio: number }
> = [
  { sessions: 1, chunksPerSession: 200, chunkIntervalMs: 5, minRatio: 2.5 },
  { sessions: 4, chunksPerSession: 200, chunkIntervalMs: 5, minRatio: 6 },
  { sessions: 4, chunksPerSession: 500, chunkIntervalMs: 1, minRatio: 20 },
];

/**
 * Expected final lastAgentText for N chunks.
 * @param n Chunk count.
 */
function fullText(n: number): string {
  return Array.from({ length: n }, (_, i) => `w${i + 1} `).join("");
}

describe("live stream store notifications (measurement harness)", () => {
  for (const scenario of SCENARIOS) {
    const { minRatio, ...probe } = scenario;
    const name = `K=${probe.sessions} N=${probe.chunksPerSession} every ${probe.chunkIntervalMs}ms`;

    it(`coalescing cuts notifications without changing the result · ${name}`, async () => {
      const label = `${probe.sessions}-${probe.chunksPerSession}-${probe.chunkIntervalMs}`;
      const before = await runStreamNotifyProbe({
        ...probe,
        label: `before-${label}`,
        coalesce: false,
      });
      const after = await runStreamNotifyProbe({
        ...probe,
        label: `after-${label}`,
        coalesce: true,
      });
      console.log(
        `[stream-notify] ${name}: store notifications ${before.storeNotifications} → ${after.storeNotifications}` +
          `, relay notifies ${before.handlerNotifies} → ${after.handlerNotifies}` +
          `, max/frame/session ${before.maxStreamingNotifiesPerFrame} → ${after.maxStreamingNotifiesPerFrame}` +
          `, tokenUsage RPCs ${before.tokenUsageCalls} → ${after.tokenUsageCalls}`,
      );

      const expected = fullText(probe.chunksPerSession);
      assert.deepEqual(before.finalTexts, Array(probe.sessions).fill(expected));
      assert.deepEqual(after.finalTexts, before.finalTexts, "no lost chunk");
      assert.deepEqual(after.finalStatuses, before.finalStatuses);
      assert.ok(after.finalStatuses.every((s) => s === "idle"));

      assert.ok(
        after.storeNotifications * minRatio <= before.storeNotifications,
        `expected ≥${minRatio}× fewer notifications: ${before.storeNotifications} → ${after.storeNotifications}`,
      );
      assert.equal(after.maxStreamingNotifiesPerFrame, 1, "≤ 1 notify per frame per session");

      // Settle hooks: queued follow-up drained once; occupancy RPC at most once.
      assert.equal(before.drainedPrompts, 1);
      assert.equal(after.drainedPrompts, 1);
      assert.equal(after.tokenUsageCalls, before.tokenUsageCalls);
      assert.ok(after.tokenUsageCalls <= 1);
    });
  }

  it("settle hooks fire exactly once per settled turn across several turns", async () => {
    const probe = { sessions: 2, chunksPerSession: 60, chunkIntervalMs: 3, turns: 3 };
    const before = await runStreamNotifyProbe({ ...probe, label: "turns-before", coalesce: false });
    const after = await runStreamNotifyProbe({ ...probe, label: "turns-after", coalesce: true });
    assert.equal(before.drainedPrompts, 3);
    assert.equal(after.drainedPrompts, 3, "one drain per settle");
    assert.equal(after.tokenUsageCalls, before.tokenUsageCalls);
    assert.deepEqual(after.finalTexts, before.finalTexts);
    assert.deepEqual(after.finalStatuses, before.finalStatuses);
  });
});
