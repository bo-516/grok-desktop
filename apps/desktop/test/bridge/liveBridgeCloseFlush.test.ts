/**
 * connectLiveBridge wiring for stream coalescing: notifies are deferred to
 * a frame, and socket close / handle.close() land pending chunks before the
 * store hears about the close. Uses an in-test WebSocket double (no network,
 * no agent) installed on globalThis only for the duration of each test.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { connectLiveBridge } from "@/bridge/liveBridge";
import type { BridgeServerMsg } from "@/bridge/liveBridgeTypes";

/** Minimal WebSocket double: records the instance so tests can push frames. */
class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  /** @param _url Ignored; nothing is dialled. */
  constructor(_url: string) {
    FakeSocket.last = this;
  }

  /** Outbound frames are irrelevant here. */
  send(): void {
    /* no-op */
  }

  /** Mirror the browser: closing fires onclose asynchronously. */
  close(): void {
    setTimeout(() => this.onclose?.(), 0);
  }

  /** @param msg Server frame to deliver. */
  push(msg: BridgeServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

/** Original global, restored after each test. */
const realSocket = (globalThis as { WebSocket?: unknown }).WebSocket;

/**
 * agent_message_chunk frame.
 * @param i Chunk index.
 */
function chunk(i: number): BridgeServerMsg {
  return {
    type: "session_update",
    sessionId: "a",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `w${i} ` },
    },
    eventId: `a-${i}`,
  };
}

/**
 * Connect with recording handlers and put session "a" mid-turn.
 * @returns Socket double, handle and the ordered event log.
 */
function connect(): {
  socket: FakeSocket;
  handle: ReturnType<typeof connectLiveBridge>;
  log: string[];
} {
  const log: string[] = [];
  const handle = connectLiveBridge("ws://fake", {
    onState: () => {
      log.push("state");
    },
    onSessionUpdate: (s) => {
      log.push(`update:${s.lastAgentText.trim()}`);
    },
    onClose: () => {
      log.push("close");
    },
    isForegroundSession: () => true,
  });
  const socket = FakeSocket.last!;
  socket.push({ type: "session_lifecycle", sessionId: "a", status: "streaming" });
  log.length = 0;
  return { socket, handle, log };
}

describe("connectLiveBridge stream coalescing", () => {
  beforeEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
  });
  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = realSocket;
    FakeSocket.last = null;
  });

  it("defers chunk notifies to the next frame (timer fallback under Node)", async () => {
    const { socket, log } = connect();
    socket.push(chunk(1));
    socket.push(chunk(2));
    assert.deepEqual(log, []);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(log, ["update:w1 w2"]);
  });

  it("socket close emits pending chunks before onClose", () => {
    const { socket, log } = connect();
    socket.push(chunk(1));
    socket.onclose?.();
    assert.deepEqual(log, ["update:w1", "close"]);
  });

  it("handle.close() lands pending chunks synchronously", async () => {
    const { socket, handle, log } = connect();
    socket.push(chunk(1));
    handle.close();
    assert.deepEqual(log, ["update:w1"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(log, ["update:w1", "close"]);
  });

  it("handle.flushPendingUpdates() emits at once and leaves nothing for the frame", async () => {
    const { socket, handle, log } = connect();
    socket.push(chunk(1));
    handle.flushPendingUpdates?.();
    assert.deepEqual(log, ["update:w1"]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(log, ["update:w1"]);
  });
});
