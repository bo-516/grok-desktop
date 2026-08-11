/**
 * Node bridge: session/load replay frames WS as replay_begin → (0 updates) → replay_end.
 * Drives the shipped createSessionReplayGate used by wsSessionLifecycle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import type { ServerMsg } from "../src/protocol.js";
import { createSessionReplayGate } from "../src/sessionReplayGate.js";

describe("wsSessionLifecycle replay framing", () => {
  it("回放窗口括住 update 突发", () => {
    const msgs: ServerMsg[] = [];
    const gate = createSessionReplayGate((m) => msgs.push(m));
    const sid = "s-load";
    const n = 12;

    gate.onReplayChange(true, sid);
    for (let i = 0; i < n; i++) {
      gate.onSessionUpdate(
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `w${i} ` },
        },
        sid,
        `${sid}-${i}`,
      );
    }
    // AcpClient setReplaying(false) order: onReplayChange(false) then onState.
    gate.onReplayChange(false, sid);
    const finished = {
      ...createSessionState({ id: sid, workspace: "/w" }),
      status: "idle" as const,
      lastAgentText: "done",
      timeline: Array.from({ length: n }, (_, i) => ({
        kind: "agent" as const,
        id: `a${i}`,
        text: `w${i} `,
        origin: "agent" as const,
      })),
    };
    const handled = gate.onState(finished);
    assert.equal(handled, true);

    const types = msgs.map((m) => m.type);
    assert.deepEqual(types, ["replay_begin", "replay_end"]);
    assert.equal(
      msgs.filter((m) => m.type === "session_update").length,
      0,
    );
    const end = msgs.find((m) => m.type === "replay_end");
    assert.ok(end && end.type === "replay_end");
    if (end && end.type === "replay_end") {
      assert.ok(end.session);
      assert.equal(end.session?.timeline.length, n);
      assert.equal(end.updates, undefined);
      assert.equal(end.count, n);
      assert.equal(end.status, "idle");
    }
  });

  it("load 失败也关窗口(I4)", () => {
    const msgs: ServerMsg[] = [];
    const gate = createSessionReplayGate((m) => msgs.push(m));
    const sid = "s-fail";
    gate.onReplayChange(true, sid);
    gate.onReplayChange(false, sid);
    gate.onState({
      ...createSessionState({ id: sid, workspace: "/w" }),
      status: "idle",
    });
    const types = msgs.map((m) => m.type);
    assert.ok(types.includes("replay_begin"));
    assert.ok(types.includes("replay_end"));
    assert.equal(
      msgs.filter((m) => m.type === "session_update").length,
      0,
    );
  });

  it("replay_end 带完整快照", () => {
    const msgs: ServerMsg[] = [];
    const gate = createSessionReplayGate((m) => msgs.push(m));
    const sid = "s-snap";
    const n = 5;
    gate.onReplayChange(true, sid);
    for (let i = 0; i < n; i++) {
      gate.onSessionUpdate(
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${i}` },
        },
        sid,
        null,
      );
    }
    gate.onReplayChange(false, sid);
    gate.onState({
      ...createSessionState({ id: sid, workspace: "/w" }),
      status: "idle",
      timeline: Array.from({ length: n }, (_, i) => ({
        kind: "agent" as const,
        id: `a${i}`,
        text: `${i}`,
        origin: "agent" as const,
      })),
    });
    const end = msgs.find((m) => m.type === "replay_end");
    assert.ok(end && end.type === "replay_end");
    if (end && end.type === "replay_end") {
      assert.equal(end.session?.timeline.length, n);
      assert.equal(end.updates, undefined);
      assert.equal(end.count, n);
    }
  });

  it("live path still fans out when not replaying", () => {
    const msgs: ServerMsg[] = [];
    const gate = createSessionReplayGate((m) => msgs.push(m));
    gate.onSessionUpdate(
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "live" },
      },
      "s-live",
      "e1",
    );
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]?.type, "session_update");
  });
});
