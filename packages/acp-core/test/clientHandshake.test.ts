/**
 * Handshake keeps session/new and session/load configOptions.
 * Interim notifications are only the fallback when the result body is empty.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAcpHandshake } from "../src/clientHandshake.js";
import { createSessionState } from "../src/timeline.js";
import type { SessionState } from "../src/types.js";

const init = {
  authMethods: [],
  _meta: {
    modelState: {
      currentModelId: "grok-4.7",
      availableModels: [
        { modelId: "grok-4.5", name: "Grok 4.5" },
        {
          modelId: "grok-4.7",
          name: "Grok 4.7",
          _meta: { reasoningEffort: "xhigh" },
        },
      ],
    },
  },
};

function scriptedHost(
  respond: (method: string, state: SessionState) => unknown,
) {
  let state = createSessionState({ id: "", workspace: "/w", model: "" });
  return {
    getState: () => state,
    host: {
      request: async (method: string) => respond(method, state),
      getSessionState: () => state,
      replaceSessionState: (next: SessionState) => {
        state = next;
      },
    },
  };
}

describe("runAcpHandshake configOptions", () => {
  it("keeps session/new result configOptions and currentModelId", async () => {
    const rig = scriptedHost((method) => {
      if (method === "initialize") {
        return init;
      }
      if (method === "session/new") {
        return {
          sessionId: "s-new",
          models: { currentModelId: "grok-4.7" },
          configOptions: [
            { id: "model", currentValue: "grok-4.7" },
            { id: "reasoning_effort", currentValue: "xhigh" },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    await runAcpHandshake(rig.host, { cwd: "/w" });
    const state = rig.getState();
    assert.equal(state.model, "grok-4.7");
    assert.equal(state.configOptions?.length, 2);
    const effort = state.configOptions?.[1] as { currentValue?: string };
    assert.equal(effort.currentValue, "xhigh");
    const current = state.availableModels?.find((m) => m.id === "grok-4.7");
    assert.equal(current?.reasoningEffort, "xhigh");
  });

  it("keeps an in-flight config_option_update when session/new result is empty", async () => {
    const rig = scriptedHost((method, state) => {
      if (method === "initialize") {
        return init;
      }
      if (method === "session/new") {
        rig.host.replaceSessionState({
          ...state,
          configOptions: [
            { id: "reasoning_effort", currentValue: "xhigh" },
          ],
        });
        return { sessionId: "s-new", configOptions: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    await runAcpHandshake(rig.host, { cwd: "/w" });
    assert.equal(rig.getState().configOptions?.length, 1);
  });

  it("keeps session/load result configOptions", async () => {
    const rig = scriptedHost((method) => {
      if (method === "initialize") {
        return init;
      }
      if (method === "session/load") {
        return {
          models: { currentModelId: "grok-4.7" },
          configOptions: [
            { id: "reasoning_effort", currentValue: "xhigh" },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    await runAcpHandshake(rig.host, { cwd: "/w", resumeId: "s-load" });
    assert.equal(rig.getState().id, "s-load");
    assert.equal(rig.getState().configOptions?.length, 1);
  });
});
