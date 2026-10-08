/**
 * Integrated terminal client channel: seq ordering, create/list correlation,
 * output backlog replay, exits, and socket-close teardown.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  binaryStringToBase64,
  createLiveBridgeTerminal,
  decodeBase64Bytes,
  type TerminalClock,
} from "@/bridge/liveBridgeTerminal";
import type { TerminalExit } from "@/bridge/liveBridgeTerminalTypes";

/** Manual clock: timers fire only when `fire()` is called. */
function manualClock(): TerminalClock & { fire: () => void } {
  const timers = new Map<number, () => void>();
  const seq = { n: 0 };
  return {
    setTimeout: (fn) => {
      seq.n += 1;
      timers.set(seq.n, fn);
      return seq.n;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    fire: () => {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach((fn) => fn());
    },
  };
}

/** Channel wired to an in-memory outbox. */
function setup(connected = true) {
  const sent: Array<Record<string, unknown>> = [];
  const clock = manualClock();
  const channel = createLiveBridgeTerminal((message) => {
    if (!connected) {
      return false;
    }
    sent.push(message as Record<string, unknown>);
    return true;
  }, clock);
  return { sent, channel, clock };
}

/** Base64 of a UTF-8 string (what the bridge sends). */
function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

const INFO = {
  terminalId: "pty-1",
  cwd: "/w",
  shell: "/bin/zsh",
  pid: 42,
  cols: 80,
  rows: 24,
};

describe("liveBridgeTerminal", () => {
  it("create sends the request and resolves with the bridge info", async () => {
    const { sent, channel } = setup();
    const pending = channel.api.create({ sessionId: "s1", cwd: "/w", cols: 100, rows: 30 });
    assert.equal(sent[0].type, "terminal_create");
    assert.equal(sent[0].cols, 100);
    channel.handleServerMsg({
      type: "terminal_created",
      requestId: sent[0].requestId,
      ok: true,
      terminal: INFO,
    } as never);
    assert.deepEqual(await pending, INFO);
  });

  it("create rejects with the bridge error and on timeout / offline", async () => {
    const { sent, channel, clock } = setup();
    const failing = channel.api.create({ cols: 1, rows: 1 });
    channel.handleServerMsg({
      type: "terminal_created",
      requestId: sent[0].requestId,
      ok: false,
      error: "terminal cwd not found: /nope",
    } as never);
    await assert.rejects(failing, /cwd not found/);

    const slow = channel.api.list();
    clock.fire();
    await assert.rejects(slow, /timed out/);

    const offline = setup(false);
    await assert.rejects(offline.channel.api.create({ cols: 1, rows: 1 }), /not connected/);
  });

  it("numbers input and resize with one per-terminal sequence", () => {
    const { sent, channel } = setup();
    channel.api.write("pty-1", "ls\r");
    channel.api.resize("pty-1", 120, 40);
    channel.api.writeBinary("pty-1", "\u001b[M ÿ");
    channel.api.write("pty-2", "x");
    assert.deepEqual(
      sent.map((m) => [m.terminalId, m.seq, m.type]),
      [
        ["pty-1", 1, "terminal_input"],
        ["pty-1", 2, "terminal_resize"],
        ["pty-1", 3, "terminal_input"],
        ["pty-2", 1, "terminal_input"],
      ],
    );
    const bytes = decodeBase64Bytes(sent[2].dataBase64 as string);
    assert.equal(bytes[bytes.length - 1], 0xff);
  });

  it("replays output that arrived before subscribe, then streams live", () => {
    const { channel } = setup();
    channel.handleServerMsg({ type: "terminal_output", terminalId: "pty-1", data: b64("early ") } as never);
    const chunks: string[] = [];
    channel.api.subscribe("pty-1", {
      onOutput: (bytes) => chunks.push(Buffer.from(bytes).toString("utf8")),
      onExit: () => undefined,
    });
    channel.handleServerMsg({ type: "terminal_output", terminalId: "pty-1", data: b64("late") } as never);
    assert.deepEqual(chunks, ["early ", "late"]);
  });

  it("delivers exit once, blocks further input, and forgets after detach", () => {
    const { sent, channel } = setup();
    const exits: TerminalExit[] = [];
    const detach = channel.api.subscribe("pty-1", {
      onOutput: () => undefined,
      onExit: (exit) => exits.push(exit),
    });
    channel.handleServerMsg({ type: "terminal_exit", terminalId: "pty-1", exitCode: 3, killed: false } as never);
    channel.handleServerMsg({ type: "terminal_exit", terminalId: "pty-1", exitCode: 9, killed: true } as never);
    assert.deepEqual(exits, [{ reason: "exited", exitCode: 3 }]);
    assert.equal(channel.api.write("pty-1", "x"), false);
    assert.equal(sent.length, 0);
    detach();
    // A fresh subscribe after forget sees no stale exit.
    const later: TerminalExit[] = [];
    channel.api.subscribe("pty-1", { onOutput: () => undefined, onExit: (e) => later.push(e) });
    assert.deepEqual(later, []);
  });

  it("socket close ends live terminals as disconnected and rejects requests", async () => {
    const { channel } = setup();
    const exits: TerminalExit[] = [];
    channel.api.subscribe("pty-7", { onOutput: () => undefined, onExit: (e) => exits.push(e) });
    const pending = channel.api.list();
    channel.closeAll("Bridge disconnected");
    await assert.rejects(pending, /Bridge disconnected/);
    assert.deepEqual(exits, [
      { reason: "disconnected", exitCode: null, message: "Bridge disconnected" },
    ]);
  });

  it("terminal_error marks the terminal ended; other frames are not consumed", () => {
    const { channel } = setup();
    const exits: TerminalExit[] = [];
    channel.api.subscribe("pty-3", { onOutput: () => undefined, onExit: (e) => exits.push(e) });
    assert.equal(
      channel.handleServerMsg({ type: "terminal_error", terminalId: "pty-3", message: "unknown terminal: pty-3" } as never),
      true,
    );
    assert.equal(exits[0].reason, "error");
    assert.equal(channel.handleServerMsg({ type: "pool" }), false);
  });

  it("ack sends credit only for positive byte counts", () => {
    const { sent, channel } = setup();
    assert.equal(channel.api.ack("pty-1", 0), false);
    channel.api.ack("pty-1", 512);
    assert.deepEqual(sent, [{ type: "terminal_ack", terminalId: "pty-1", bytes: 512 }]);
  });

  it("base64 helpers round-trip binary strings and tolerate garbage", () => {
    const encoded = binaryStringToBase64("\u0000\u0080ÿ");
    assert.deepEqual([...decodeBase64Bytes(encoded)], [0, 0x80, 0xff]);
    assert.equal(decodeBase64Bytes("%%%").length, 0);
  });
});
