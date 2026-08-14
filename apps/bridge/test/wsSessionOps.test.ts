/**
 * Mid-session WS ops: token_usage / billing / fork_session / set_model
 * restart_required. Uses injected runtimes — never starts grok.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WebSocket } from "ws";
import type { ServerMsg } from "../src/protocol.js";
import { RuntimePool } from "../src/runtimePool.js";
import {
  handleBilling,
  handleForkSession,
  handleSetModel,
  handleTokenUsage,
  type SessionOpDeps,
  type SessionOpRuntime,
} from "../src/wsSessionOps.js";

/**
 * Build ops deps that record outbound frames and return a fixed runtime.
 * @param runtime Session runtime the handlers should use.
 * @param sent Collector for `send` frames.
 */
function makeDeps(
  runtime: SessionOpRuntime,
  sent: ServerMsg[],
): SessionOpDeps {
  return {
    pool: new RuntimePool(4),
    send: (_ws, msg) => {
      sent.push(msg);
    },
    requireRuntime: () => runtime,
    getDefaultListCwd: () => "/tmp",
    onAuthLogout: () => undefined,
  };
}

/** Dummy socket — handlers never read the connection, only `send`. */
const ws = {} as WebSocket;

describe("handleTokenUsage", () => {
  it("wraps a successful RPC in cli_result", async () => {
    const sent: ServerMsg[] = [];
    const deps = makeDeps(
      {
        sessionId: "s1",
        tokenUsage: async () => ({ used: 137_217 }),
      },
      sent,
    );
    await handleTokenUsage(deps, ws, "s1", "req-1");
    assert.deepEqual(sent[0], {
      type: "cli_result",
      result: { requestId: "req-1", ok: true, data: { used: 137_217 } },
    });
  });

  it("reports missing method and RPC errors without throwing", async () => {
    const missing: ServerMsg[] = [];
    await handleTokenUsage(
      makeDeps({ sessionId: "s1" }, missing),
      ws,
      "s1",
      "req-miss",
    );
    assert.equal(missing[0]?.type, "cli_result");
    if (missing[0]?.type === "cli_result") {
      assert.equal(missing[0].result.ok, false);
      assert.match(missing[0].result.error ?? "", /not available/);
    }

    const failed: ServerMsg[] = [];
    await handleTokenUsage(
      makeDeps(
        {
          sessionId: "s1",
          tokenUsage: async () => {
            throw new Error("timeout");
          },
        },
        failed,
      ),
      ws,
      "s1",
      "req-err",
    );
    if (failed[0]?.type === "cli_result") {
      assert.equal(failed[0].result.ok, false);
      assert.equal(failed[0].result.error, "timeout");
    }
  });
});

describe("handleBilling", () => {
  it("wraps `_x.ai/billing` in cli_result", async () => {
    const sent: ServerMsg[] = [];
    await handleBilling(
      makeDeps(
        {
          sessionId: "s1",
          billing: async () => ({
            config: { creditUsagePercent: 92 },
          }),
        },
        sent,
      ),
      ws,
      "s1",
      "bill-1",
    );
    assert.deepEqual(sent[0], {
      type: "cli_result",
      result: {
        requestId: "bill-1",
        ok: true,
        data: { config: { creditUsagePercent: 92 } },
      },
    });
  });

  it("reports missing billing without throwing", async () => {
    const sent: ServerMsg[] = [];
    await handleBilling(makeDeps({ sessionId: "s1" }, sent), ws, "s1", "bill-x");
    if (sent[0]?.type === "cli_result") {
      assert.equal(sent[0].result.ok, false);
      assert.match(sent[0].result.error ?? "", /not available/);
    }
  });
});

describe("handleForkSession", () => {
  it("forwards cwd overrides and returns the agent bag", async () => {
    const sent: ServerMsg[] = [];
    let seen: { sourceCwd?: string; newCwd?: string } | undefined;
    await handleForkSession(
      makeDeps(
        {
          sessionId: "s1",
          forkSession: async (opts) => {
            seen = opts;
            return { newSessionId: "fork-9" };
          },
        },
        sent,
      ),
      ws,
      "s1",
      "fork-1",
      "/src",
      "/dst",
    );
    assert.deepEqual(seen, { sourceCwd: "/src", newCwd: "/dst" });
    if (sent[0]?.type === "cli_result") {
      assert.equal(sent[0].result.ok, true);
      assert.deepEqual(sent[0].result.data, { newSessionId: "fork-9" });
    }
  });

  it("reports missing fork_session without throwing", async () => {
    const sent: ServerMsg[] = [];
    await handleForkSession(
      makeDeps({ sessionId: "s1" }, sent),
      ws,
      "s1",
      "fork-x",
    );
    if (sent[0]?.type === "cli_result") {
      assert.equal(sent[0].result.ok, false);
      assert.match(sent[0].result.error ?? "", /not available/);
    }
  });
});

describe("handleSetModel", () => {
  it("emits restart_required then rethrows on method-not-found", async () => {
    const sent: ServerMsg[] = [];
    await assert.rejects(
      () =>
        handleSetModel(
          makeDeps(
            {
              sessionId: "s1",
              setModel: async () => {
                throw new Error("Method not found (-32601)");
              },
            },
            sent,
          ),
          ws,
          "s1",
          "grok-4.5",
        ),
      /Method not found/,
    );
    assert.equal(sent[0]?.type, "restart_required");
    if (sent[0]?.type === "restart_required") {
      assert.equal(sent[0].setting, "model");
      assert.equal(sent[0].sessionId, "s1");
    }
  });

  it("sends info when set_model succeeds", async () => {
    const sent: ServerMsg[] = [];
    await handleSetModel(
      makeDeps(
        {
          sessionId: "s1",
          setModel: async () => undefined,
        },
        sent,
      ),
      ws,
      "s1",
      "grok-4.6",
    );
    assert.deepEqual(sent[0], {
      type: "info",
      message: "model set to grok-4.6",
      sessionId: "s1",
    });
  });
});
