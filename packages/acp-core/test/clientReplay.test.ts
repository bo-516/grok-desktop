/**
 * session/load replay gate: restoring history must cost one state fan-out and
 * must not leave the session looking live (which makes turns enter expanded).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AcpClient } from "../src/client.js";
import { createMockAcpPair } from "../src/mockAgent.js";
import type { SessionState } from "../src/types.js";

describe("session/load replay gate", () => {
  it("coalesces replayed chunks into a single idle state", async () => {
    const pair = createMockAcpPair({
      emitPermission: false,
      chunkDelayMs: 1,
      loadReplayTurns: 3,
    });
    const states: SessionState[] = [];
    const client = new AcpClient({
      transport: pair.clientTransport,
      settleQuietMs: 10,
      onStateChange: (s) => states.push(s),
    });
    const sessionId = "mock-session-replay-1";

    await client.handshake({
      cwd: "/tmp/replay-ws",
      resumeId: sessionId,
      seed: {
        id: sessionId,
        workspace: "/tmp/replay-ws",
        model: "",
        mode: "build",
        status: "idle",
        timeline: [],
        toolCalls: {},
        lastAgentText: "",
      },
    });

    const afterSeed = states.slice(1);
    // 3 turns × 4 replayed updates would be 12 paints without the gate.
    assert.equal(afterSeed.length, 1);
    const final = afterSeed[0];
    assert.equal(final?.status, "idle");
    assert.equal(
      final?.timeline.filter((item) => item.kind === "user").length,
      3,
    );
    assert.equal(Object.keys(final?.toolCalls ?? {}).length, 3);
    const lastItem = final?.timeline[final.timeline.length - 1];
    assert.equal(lastItem?.kind, "agent");
    assert.equal(
      lastItem?.kind === "agent" ? lastItem.text : "",
      "answer 3",
    );

    client.dispose();
    pair.dispose();
  });

  it("keeps streaming live after the replay window closes", async () => {
    const pair = createMockAcpPair({
      emitPermission: false,
      chunkDelayMs: 1,
      loadReplayTurns: 1,
    });
    const states: SessionState[] = [];
    const client = new AcpClient({
      transport: pair.clientTransport,
      settleQuietMs: 10,
      onStateChange: (s) => states.push(s),
    });

    await client.handshake({
      cwd: "/tmp/replay-ws",
      resumeId: "mock-session-replay-2",
    });
    const afterResume = states.length;

    client.dispatchMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "mock-session-replay-2",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "live again" },
        },
      },
    });

    // A post-replay chunk must fan out immediately, otherwise resuming a
    // session would mute every later token.
    assert.equal(states.length, afterResume + 1);
    assert.equal(states[states.length - 1]?.status, "streaming");
    assert.ok(client.getSessionState().lastAgentText.endsWith("live again"));

    client.dispose();
    pair.dispose();
  });
});
