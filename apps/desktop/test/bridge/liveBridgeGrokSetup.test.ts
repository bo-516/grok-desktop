/**
 * Onboarding bridge client: setup-run correlation (started / output / exit),
 * grok_bin request correlation, socket-loss settlement, and routing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLiveBridgeGrokSetup } from "@/bridge/liveBridgeGrokSetup";

/**
 * Fake socket send that records frames.
 * @param connected What send returns.
 * @returns The send function and the recorded frames.
 */
function fakeSend(connected = true) {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    send: (message: unknown) => {
      sent.push(message as Record<string, unknown>);
      return connected;
    },
  };
}

describe("createLiveBridgeGrokSetup", () => {
  it("sends only the action and routes started / output / exit by runId", async () => {
    const { sent, send } = fakeSend();
    const client = createLiveBridgeGrokSetup(send);
    const output: string[] = [];
    let startedArgv: string[] = [];
    const { runId, done } = client.api.run("install", {
      onStarted: (command) => {
        startedArgv = command.argv;
      },
      onOutput: (text) => output.push(text),
    });
    assert.deepEqual(sent[0], { type: "grok_setup_run", runId, action: "install" });
    const command = { action: "install", display: "d", argv: ["bash", "-c", "x"] };
    assert.equal(
      client.handleServerMsg({ type: "grok_setup_started", runId, command }),
      true,
    );
    client.handleServerMsg({ type: "grok_setup_output", runId: "other", text: "nope" });
    client.handleServerMsg({ type: "grok_setup_output", runId, text: "hello " });
    client.handleServerMsg({ type: "grok_setup_output", runId, text: "world" });
    client.handleServerMsg({ type: "grok_setup_exit", runId, ok: true, code: 0 });
    const exit = await done;
    assert.deepEqual(startedArgv, ["bash", "-c", "x"]);
    assert.equal(output.join(""), "hello world");
    assert.deepEqual(exit, { ok: true, code: 0 });
  });

  it("cancel sends the run id", () => {
    const { sent, send } = fakeSend();
    const client = createLiveBridgeGrokSetup(send);
    client.api.cancel("setup-1");
    assert.deepEqual(sent[0], { type: "grok_setup_cancel", runId: "setup-1" });
  });

  it("settles instead of hanging when offline or the socket drops", async () => {
    const offline = createLiveBridgeGrokSetup(fakeSend(false).send);
    const exit = await offline.api.run("update", {}).done;
    assert.equal(exit.ok, false);
    assert.match(exit.error ?? "", /not connected/);
    const reply = await offline.api.getBinSetting();
    assert.equal(reply.ok, false);

    const online = createLiveBridgeGrokSetup(fakeSend().send);
    const pendingRun = online.api.run("install", {}).done;
    const pendingBin = online.api.setBinSetting("/x");
    online.failAll("Bridge WebSocket closed");
    assert.equal((await pendingRun).error, "Bridge WebSocket closed");
    assert.equal((await pendingBin).error, "Bridge WebSocket closed");
  });

  it("correlates grok_bin replies by requestId", async () => {
    const { sent, send } = fakeSend();
    const client = createLiveBridgeGrokSetup(send);
    const pending = client.api.setBinSetting("~/bin/grok");
    const frame = sent[0];
    assert.equal(frame.type, "grok_bin_set");
    assert.equal(frame.path, "~/bin/grok");
    const setting = {
      customPath: "/h/bin/grok",
      envOverride: "",
      resolvedPath: "/h/bin/grok",
      source: "setting",
      resolveError: "",
    };
    client.handleServerMsg({
      type: "grok_bin",
      requestId: frame.requestId,
      ok: true,
      setting,
    });
    const reply = await pending;
    assert.equal(reply.ok, true);
    assert.deepEqual(reply.setting, setting);
  });

  it("leaves unrelated frames to other routers", () => {
    const client = createLiveBridgeGrokSetup(fakeSend().send);
    assert.equal(client.handleServerMsg({ type: "environment" }), false);
    assert.equal(client.handleServerMsg({ type: "cli_result" }), false);
  });
});
