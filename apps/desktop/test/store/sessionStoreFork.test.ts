/**
 * Fork action: restore empty canvas during RPC, catalog seed, select on success.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState, type TimelineItem } from "@grok-desktop/acp-core";
import {
  forkSessionAction,
  waitRemainingHold,
} from "../../src/store/sessionStoreFork";
import type {
  SessionStore,
  SessionStoreGet,
  SessionStoreSet,
} from "../../src/store/sessionStoreTypes";

const userItem: TimelineItem = {
  kind: "user",
  id: "u1",
  blocks: [{ type: "text", text: "hi" }],
  origin: "local",
};

/**
 * Minimal mutable store harness for forkSessionAction.
 * @param partial Initial fields.
 */
function makeHarness(partial: Partial<SessionStore>) {
  let state = {
    session: createSessionState({
      id: "parent-1",
      workspace: "/work",
      mode: "build",
    }),
    connectionMode: "live-bridge" as const,
    bridgeInfo: "",
    lastError: null as string | null,
    live: null as SessionStore["live"],
    catalog: [] as SessionStore["catalog"],
    activeSessionId: "parent-1" as string | null,
    viewingSessionId: "parent-1" as string | null,
    viewingSubagent: false,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: {},
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
    poolEntries: [],
    environment: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: null,
    promptQueue: [],
    restartNotice: null,
    clearPendingMode: () => {
      state = { ...state, pendingMode: null };
    },
    ...partial,
  } as unknown as SessionStore;

  const set: SessionStoreSet = (partialOrFn) => {
    const next =
      typeof partialOrFn === "function" ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...next };
  };
  const get: SessionStoreGet = () => state;
  return { set, get, getState: () => state };
}

describe("waitRemainingHold", () => {
  it("returns immediately when holdMs is 0 or already elapsed", async () => {
    const t0 = Date.now();
    await waitRemainingHold(t0, 0);
    await waitRemainingHold(t0 - 50, 10);
    assert.ok(Date.now() - t0 < 50);
  });
});

describe("forkSessionAction", () => {
  it("rejects when bridge is disconnected", async () => {
    const h = makeHarness({ connectionMode: "disconnected", live: null });
    const r = await forkSessionAction(h.set, h.get, { holdMs: 0 });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /bridge/i);
    }
  });

  it("rejects when canvas has no session id", async () => {
    const h = makeHarness({
      live: {
        forkSession: async () => ({ requestId: "x", ok: true, data: {} }),
      } as SessionStore["live"],
      session: createSessionState({ id: "", workspace: "/work", mode: "build" }),
    });
    const r = await forkSessionAction(h.set, h.get, { holdMs: 0 });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /no active session/i);
    }
  });

  it("paints restore empty during RPC, then seeds and switches on success", async () => {
    let sawStreaming = false;
    let midFlightEmpty = false;
    let midFlightRestoring = false;
    const parentSession = createSessionState({
      id: "parent-1",
      workspace: "/work",
      mode: "build",
    });
    parentSession.timeline = [userItem];
    parentSession.lastAgentText = "hi";
    const h = makeHarness({
      session: parentSession,
      live: {
        forkSession: async () => {
          const mid = h.getState();
          if (mid.session.status === "streaming") {
            sawStreaming = true;
          }
          midFlightEmpty = mid.session.timeline.length === 0;
          midFlightRestoring = mid.restoringSessionId === "parent-1";
          return {
            requestId: "fork-1",
            ok: true,
            data: {
              newSessionId: "child-9",
              parentSessionId: "parent-1",
              newCwd: "/work",
              chatMessagesCopied: 2,
            },
          };
        },
      } as SessionStore["live"],
      catalog: [
        {
          id: "parent-1",
          workspace: "/work",
          title: "Parent chat",
          mode: "build",
          model: "",
          status: "idle",
          createdAt: 1,
          updatedAt: 1,
          timeline: [userItem],
          toolCalls: {},
          lastAgentText: "hi",
        },
      ],
    });

    const r = await forkSessionAction(h.set, h.get, { holdMs: 0 });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.newSessionId, "child-9");
    }
    assert.equal(sawStreaming, false);
    assert.equal(midFlightEmpty, true);
    assert.equal(midFlightRestoring, true);
    const child = h.getState().catalog.find((c) => c.id === "child-9");
    assert.ok(child);
    assert.equal(child?.parentSessionId, "parent-1");
    assert.match(child?.title ?? "", /Fork/);
    assert.equal(child?.timeline.length, 1);
    // selectSessionAction focuses the child when the catalog seed is present.
    assert.equal(h.getState().viewingSessionId, "child-9");
  });

  it("restores the parent transcript on RPC failure", async () => {
    const parentSession = createSessionState({
      id: "parent-1",
      workspace: "/work",
      mode: "build",
    });
    parentSession.timeline = [userItem];
    const h = makeHarness({
      session: parentSession,
      live: {
        forkSession: async () => ({
          requestId: "fork-1",
          ok: false,
          error: "boom",
        }),
      } as SessionStore["live"],
    });
    const r = await forkSessionAction(h.set, h.get, { holdMs: 0 });
    assert.equal(r.ok, false);
    assert.equal(h.getState().session.status, "idle");
    assert.equal(h.getState().session.timeline.length, 1);
    assert.equal(h.getState().restoringSessionId, null);
    assert.match(h.getState().bridgeInfo, /boom/);
  });
});
