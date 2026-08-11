/**
 * T3: post-await select guard — superseded start must not repaint the canvas.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createSessionState, type SessionState } from "@grok-desktop/acp-core";
import { startLiveBridgeSession } from "@/store/sessionStoreLive";
import type { StartOpts } from "@/store/sessionStoreSupport";

/** Minimal WebSocket stub: ready resolves only when test calls open(). */
class DeferredWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = DeferredWebSocket.CONNECTING;
  onopen: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev?: unknown) => void) | null = null;
  /** @param _url Bridge URL (unused). */
  constructor(_url: string) {
    deferredSockets.push(this);
  }
  send(_data: string): void {
    /* ignore outbound */
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

describe("startLiveBridgeSession guard (T3)", () => {
  beforeEach(() => {
    deferredSockets.length = 0;
    (
      globalThis as unknown as { WebSocket: typeof DeferredWebSocket }
    ).WebSocket = DeferredWebSocket;
  });

  afterEach(() => {
    (
      globalThis as unknown as { WebSocket: typeof RealWebSocket }
    ).WebSocket = RealWebSocket;
  });

  it("guard 守卫: delayed ready + dual start keeps later session", async () => {
    type Slice = {
      session: SessionState;
      connectionMode: "live-bridge" | "disconnected" | "connecting";
      bridgeInfo: string;
      lastError: string | null;
      live: ReturnType<
        typeof import("@/store/sessionStoreLive").startLiveBridgeSession
      > extends Promise<void>
        ? unknown
        : never;
      catalog: never[];
      activeSessionId: string | null;
      viewingSessionId: string | null;
      poolEntries: never[];
      environment: null;
      promptQueue: never[];
      restartNotice: null;
      localDraft: boolean;
      creatingSession: boolean;
      pendingMode: null;
      restoringSessionId: string | null;
    };

    let state: Slice = {
      session: createSessionState({ id: "", workspace: "/w" }),
      connectionMode: "disconnected",
      bridgeInfo: "",
      lastError: null,
      live: null as never,
      catalog: [],
      activeSessionId: null,
      viewingSessionId: null,
      poolEntries: [],
      environment: null,
      promptQueue: [],
      restartNotice: null,
      localDraft: false,
      creatingSession: false,
      pendingMode: null,
      restoringSessionId: null,
    };

    /** Canvas sets that touch viewingSessionId after connect (post-await). */
    const viewingSets: (string | null | undefined)[] = [];

    const get = () => state as never;
    const set = (partial: Partial<Slice> | ((s: Slice) => Partial<Slice>)) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      if ("viewingSessionId" in patch) {
        viewingSets.push(patch.viewingSessionId);
      }
      if ("session" in patch && patch.session) {
        // Track canvas session id stamps from seed path.
        if (patch.session.id) {
          viewingSets.push(patch.session.id);
        }
      }
      state = { ...state, ...patch, live: (patch.live ?? state.live) as never };
    };

    let selectSeq = 0;
    const startOne = (id: string, opts: StartOpts) => {
      const seq = ++selectSeq;
      return startLiveBridgeSession(set as never, get, {
        ...opts,
        resumeId: id,
        seed: createSessionState({ id, workspace: "/w" }),
        forceNew: false,
        guard: () => seq === selectSeq,
        url: "ws://127.0.0.1:9",
      });
    };

    // Fire s1 then s2 before either ready resolves.
    const p1 = startOne("s1", {});
    const p2 = startOne("s2", {});
    assert.ok(deferredSockets.length >= 1);

    // Open all deferred sockets (both starts may share or recreate).
    for (const sock of deferredSockets) {
      sock.open();
    }

    await Promise.allSettled([p1, p2]);

    // Final focus must be the later selection.
    assert.equal(state.viewingSessionId, "s2");
    // No post-await seed for s1 after s2 won: viewingSets must not end on s1.
    assert.ok(
      !viewingSets.includes("s1") ||
        viewingSets.lastIndexOf("s2") > viewingSets.lastIndexOf("s1"),
      `viewingSets=${JSON.stringify(viewingSets)}`,
    );
    // Stronger: after both settle, never leave viewing on s1.
    assert.notEqual(state.viewingSessionId, "s1");
  });
});
