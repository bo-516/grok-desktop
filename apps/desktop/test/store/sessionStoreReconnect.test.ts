/**
 * ensureLiveBridgeConnected: no-op unless disconnected; connectOnly vs resume.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionState, type SessionState } from "@grok-desktop/acp-core";
import { ensureLiveBridgeConnected } from "@/store/sessionStoreReconnect";
import { stopPoolPoll } from "@/store/sessionStoreLive";
import type { SessionRecord } from "@/store/sessionCatalog";
import type { SessionStore } from "@/store/sessionStoreTypes";

/** Minimal WebSocket stub: ready resolves only when test calls open(). */
class DeferredWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = DeferredWebSocket.CONNECTING;
  /** Outbound frames captured for connectOnly assertions. */
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev?: unknown) => void) | null = null;
  /** @param _url Bridge URL (unused). */
  constructor(_url: string) {
    deferredSockets.push(this);
  }
  /**
   * Record outbound JSON frames.
   * @param data Serialized client message.
   */
  send(data: string): void {
    this.sent.push(String(data));
  }
  close(): void {
    this.readyState = DeferredWebSocket.CLOSED;
    this.onclose?.({});
  }
  /** Test helper: mark open and resolve live.ready. */
  open(): void {
    this.readyState = DeferredWebSocket.OPEN;
    this.onopen?.({});
  }
}

const deferredSockets: DeferredWebSocket[] = [];
const RealWebSocket = globalThis.WebSocket;

/**
 * Minimal catalog row for reconnect tests.
 * @param partial Overrides including required id.
 */
function rec(
  partial: Partial<SessionRecord> & Pick<SessionRecord, "id">,
): SessionRecord {
  return {
    id: partial.id,
    workspace: partial.workspace ?? "/ws",
    title: partial.title ?? partial.id,
    mode: partial.mode ?? "build",
    model: partial.model ?? "",
    status: partial.status ?? "idle",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    timeline: partial.timeline ?? [],
    toolCalls: partial.toolCalls ?? {},
    lastAgentText: partial.lastAgentText ?? "",
  };
}

/**
 * Harness store slice for ensureLiveBridgeConnected.
 * @param overrides Fields to stamp over the disconnected empty default.
 */
function makeState(
  overrides: Partial<SessionStore> = {},
): SessionStore {
  return {
    session: createSessionState({ id: "", workspace: "/ws" }),
    connectionMode: "disconnected",
    bridgeInfo: "",
    lastError: null,
    live: null,
    catalog: [],
    activeSessionId: null,
    viewingSessionId: null,
    viewingSubagent: false,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: {},
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
    poolEntries: [],
    environment: null,
    weeklyUsage: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: null,
    promptQueue: [],
    restartNotice: null,
    ...overrides,
  } as SessionStore;
}

describe("ensureLiveBridgeConnected", () => {
  beforeEach(() => {
    deferredSockets.length = 0;
    (
      globalThis as unknown as { WebSocket: typeof DeferredWebSocket }
    ).WebSocket = DeferredWebSocket;
  });

  afterEach(() => {
    stopPoolPoll();
    for (const sock of deferredSockets) {
      sock.close();
    }
    deferredSockets.length = 0;
    (
      globalThis as unknown as { WebSocket: typeof RealWebSocket }
    ).WebSocket = RealWebSocket;
  });

  it("is a no-op while already live or connecting", async () => {
    let state = makeState({ connectionMode: "live-bridge" });
    const set = (
      partial:
        | Partial<SessionStore>
        | ((s: SessionStore) => Partial<SessionStore>),
    ) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    };
    await ensureLiveBridgeConnected(set, () => state);
    assert.equal(deferredSockets.length, 0);
    state = makeState({ connectionMode: "connecting" });
    await ensureLiveBridgeConnected(set, () => state);
    assert.equal(deferredSockets.length, 0);
  });

  it("connectOnly on a New chat draft does not send session/start", async () => {
    let state = makeState({
      localDraft: true,
      catalog: [rec({ id: "cat-1" })],
    });
    const set = (
      partial:
        | Partial<SessionStore>
        | ((s: SessionStore) => Partial<SessionStore>),
    ) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    };
    const done = ensureLiveBridgeConnected(set, () => state);
    assert.equal(state.connectionMode, "connecting");
    deferredSockets[0]?.open();
    await done;
    assert.equal(state.connectionMode, "live-bridge");
    const types = deferredSockets[0]!.sent.map(
      (raw) => (JSON.parse(raw) as { type: string }).type,
    );
    assert.ok(!types.includes("start"), `sent=${types.join(",")}`);
  });

  it("resumes the viewing session (sends start with resumeId)", async () => {
    /** Non-empty body so start skips disk hydrate (would hang without FS). */
    const seed: SessionState = {
      ...createSessionState({
        id: "view-1",
        workspace: "/proj",
      }),
      timeline: [
        {
          kind: "user",
          id: "u1",
          blocks: [{ type: "text", text: "hello" }],
        },
      ],
    };
    let state = makeState({
      viewingSessionId: "view-1",
      session: seed,
      catalog: [
        rec({
          id: "view-1",
          workspace: "/proj",
          timeline: seed.timeline,
        }),
      ],
    });
    const set = (
      partial:
        | Partial<SessionStore>
        | ((s: SessionStore) => Partial<SessionStore>),
    ) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    };
    const done = ensureLiveBridgeConnected(set, () => state);
    deferredSockets[0]?.open();
    await done;
    const startMsg = deferredSockets[0]!.sent
      .map((raw) => JSON.parse(raw) as { type: string; resumeId?: string })
      .find((msg) => msg.type === "start");
    assert.ok(startMsg);
    assert.equal(startMsg?.resumeId, "view-1");
  });
});
