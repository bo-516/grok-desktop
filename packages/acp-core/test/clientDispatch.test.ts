/**
 * Dispatch path for standard session/update vs vendor `_x.ai/session/update`.
 * Drives the real `dispatchAcpMessage` + applySessionUpdate path (no reimplementation).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  dispatchAcpMessage,
  type DispatchHost,
  type SessionState,
} from "../src/index.js";

/**
 * Minimal DispatchHost that records replaceSessionState / scheduleSettle calls.
 * @param initial Starting session snapshot.
 */
function makeHost(initial: SessionState): DispatchHost & {
  states: SessionState[];
  settleCount: number;
  promptInFlight: boolean;
} {
  const states: SessionState[] = [initial];
  let settleCount = 0;
  let promptInFlight = false;
  return {
    pending: new Map(),
    get states() {
      return states;
    },
    get settleCount() {
      return settleCount;
    },
    get promptInFlight() {
      return promptInFlight;
    },
    set promptInFlight(v: boolean) {
      promptInFlight = v;
    },
    getSessionState: () => states[states.length - 1]!,
    replaceSessionState: (state: SessionState) => {
      states.push(state);
    },
    write: () => {},
    scheduleSettle: () => {
      settleCount += 1;
    },
    isPromptInFlight: () => promptInFlight,
    autoPermissionOptionId: null,
    respondPermission: () => {},
  };
}

describe("dispatchAcpMessage session/update methods", () => {
  it("routes _x.ai/session/update with subagent_spawned through real apply path", () => {
    const host = makeHost(createSessionState({ id: "parent-1" }));
    dispatchAcpMessage(host, {
      jsonrpc: "2.0",
      method: "_x.ai/session/update",
      params: {
        sessionId: "parent-1",
        update: {
          sessionUpdate: "subagent_spawned",
          subagent_id: "019feb2e-97ef-0000-0000-000000000001",
          parent_session_id: "parent-1",
          parent_prompt_id: "acc24062-0000-0000-0000-000000000001",
          child_session_id: "019feb2e-97ef-0000-0000-000000000001",
          subagent_type: "general-purpose",
          description: "goal plan writer",
          effective_context_source: "new",
          model: "grok-4.5",
        },
      },
    });
    assert.equal(host.states.length, 2);
    const next = host.getSessionState();
    const card = next.subagents?.["019feb2e-97ef-0000-0000-000000000001"];
    assert.ok(card);
    assert.equal(card?.status, "running");
    assert.equal(card?.description, "goal plan writer");
    assert.equal(card?.type, "general-purpose");
    assert.equal(next.timeline.length, 0);
  });

  it("keeps standard session/update agent_message_chunk behavior", () => {
    const host = makeHost(createSessionState({ id: "s1" }));
    dispatchAcpMessage(host, {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hi" },
        },
      },
    });
    const next = host.getSessionState();
    assert.equal(next.timeline.length, 1);
    assert.equal(next.timeline[0]?.kind, "agent");
    assert.match(next.lastAgentText, /hi/);
  });

  it("drops unrelated _x.ai/* methods without replacing state", () => {
    const host = makeHost(createSessionState({ id: "s1" }));
    dispatchAcpMessage(host, {
      jsonrpc: "2.0",
      method: "_x.ai/session/nonsense",
      params: {
        sessionId: "s1",
        update: { sessionUpdate: "subagent_spawned", subagent_id: "x" },
      },
    });
    assert.equal(host.states.length, 1);
    assert.equal(host.getSessionState().subagents, undefined);
  });

  it("schedules settle once for vendor method while prompt is in flight", () => {
    const host = makeHost(createSessionState({ id: "s1" }));
    host.promptInFlight = true;
    dispatchAcpMessage(host, {
      jsonrpc: "2.0",
      method: "_x.ai/session/update",
      params: {
        sessionId: "s1",
        update: {
          sessionUpdate: "goal_updated",
          goal_id: "g1",
          objective: "do things",
          status: "active",
          phase: "executing",
        },
      },
    });
    assert.equal(host.settleCount, 1);
    assert.equal(host.getSessionState().goal?.goalId, "g1");
  });

  it("ignores missing sessionUpdate without throw or state change", () => {
    const host = makeHost(createSessionState({ id: "s1" }));
    dispatchAcpMessage(host, {
      jsonrpc: "2.0",
      method: "_x.ai/session/update",
      params: { sessionId: "s1", update: {} },
    });
    assert.equal(host.states.length, 1);
  });
});
