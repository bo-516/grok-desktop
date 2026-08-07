/**
 * AcpClient against in-process mock ACP agent — real handshake + stream path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AcpClient } from "../src/client.js";
import { createMockAcpPair } from "../src/mockAgent.js";

describe("AcpClient + mock agent", () => {
  it("completes initialize → authenticate → session/new → prompt with streamed text", async () => {
    const pair = createMockAcpPair({
      emitPermission: true,
      chunkDelayMs: 2,
    });
    const states: string[] = [];
    const client = new AcpClient({
      transport: pair.clientTransport,
      settleQuietMs: 30,
      autoPermissionOptionId: "allow_once",
      onStateChange: (s) => states.push(s.status),
    });

    const { init, sessionId } = await client.handshake({
      cwd: "/tmp/mock-workspace",
      envApiKeyPresent: false,
    });

    assert.ok(sessionId.startsWith("mock-session-"));
    assert.equal(init.availableModels?.[0]?.id, "grok-mock");

    const result = await client.prompt(sessionId, [
      { type: "text", text: "hello mock" },
    ]);
    assert.equal(result.stopReason, "end_turn");

    await pair.whenIdle();
    // allow settle timer
    await new Promise((r) => setTimeout(r, 50));

    const state = client.getSessionState();
    assert.match(state.lastAgentText, /Mock agent received: hello mock/);
    assert.ok(state.timeline.some((t) => t.kind === "thought"));
    assert.ok(state.timeline.some((t) => t.kind === "tool"));
    assert.ok(state.timeline.some((t) => t.kind === "agent"));
    assert.ok(state.plan && state.plan.length >= 1);

    const tool = state.toolCalls["tool-mock-1"];
    assert.ok(tool);
    assert.equal(tool.status, "completed");
    // content preserved after status-only update
    assert.ok(tool.content !== undefined);

    assert.ok(states.includes("streaming") || states.includes("waiting_permission"));

    client.dispose();
    pair.dispose();
  });

  it("cancel sends notification without throwing", async () => {
    const pair = createMockAcpPair({ emitPermission: false, chunkDelayMs: 1 });
    const client = new AcpClient({
      transport: pair.clientTransport,
      settleQuietMs: 10,
    });
    const { sessionId } = await client.handshake({ cwd: "/tmp/x" });
    client.cancel(sessionId);
    client.dispose();
    pair.dispose();
  });

  it("session/load requires cwd+mcpServers and restores model", async () => {
    const pair = createMockAcpPair({ emitPermission: false, chunkDelayMs: 1 });
    const client = new AcpClient({
      transport: pair.clientTransport,
      settleQuietMs: 10,
    });
    const sessionId = "mock-session-resume-1";
    const resumed = await client.handshake({
      cwd: "/tmp/resume-ws",
      resumeId: sessionId,
      seed: {
        id: sessionId,
        workspace: "/tmp/resume-ws",
        model: "",
        mode: "build",
        status: "idle",
        timeline: [
          {
            kind: "user",
            id: "user-1",
            blocks: [{ type: "text", text: "cached" }],
          },
        ],
        toolCalls: {},
        lastAgentText: "",
      },
    });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.sessionId, sessionId);
    assert.equal(client.getSessionState().model, "grok-mock");
    assert.equal(client.getSessionState().timeline[0]?.kind, "user");
    client.dispose();
    pair.dispose();
  });

  it("accepts grok session_info_update without rendering an unknown-update error", () => {
    const pair = createMockAcpPair({ emitPermission: false, chunkDelayMs: 1 });
    const client = new AcpClient({ transport: pair.clientTransport });

    client.dispatchMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "real-grok-session",
        update: {
          sessionUpdate: "session_info_update",
          title: "Reply Only With Ok Instruction",
        },
      },
    });

    const state = client.getSessionState();
    assert.equal(state.title, "Reply Only With Ok Instruction");
    assert.equal(state.timeline.some((item) => item.kind === "error"), false);

    client.dispose();
    pair.dispose();
  });
});
