/**
 * Navigation actions drain coalesced live stream notifies before the canvas
 * moves (select / New chat), before a row is removed, and before disconnect.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import type { SessionRecord } from "@/store/sessionCatalog";
import {
  disconnectAction,
  newSessionAction,
  removeSessionAction,
  selectSessionAction,
} from "@/store/sessionStoreNavigation";
import type { SessionStore } from "@/store/sessionStoreTypes";

const A = "nav-flush-a";
const B = "nav-flush-b";

/**
 * Catalog row with one user message (no cold restore on select).
 * @param id Session id.
 */
function rec(id: string): SessionRecord {
  return {
    id,
    workspace: "/proj",
    title: id,
    mode: "build",
    model: "grok-4.5",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    timeline: [{ kind: "user", id: `u-${id}`, blocks: [{ type: "text", text: "hi" }] }],
    toolCalls: {},
    lastAgentText: "",
  };
}

/**
 * Store double viewing A with B in the live pool; live records call order.
 * @returns get/set plus the ordered live call log.
 */
function makeStore(): {
  get: () => SessionStore;
  set: (p: unknown) => void;
  log: string[];
} {
  const log: string[] = [];
  const holder: { state: Partial<SessionStore> } = { state: {} };
  const live = {
    flushPendingUpdates: () => {
      log.push(`flush:viewing=${holder.state.viewingSessionId}:mode=${holder.state.connectionMode}`);
    },
    start: () => {
      log.push("start");
      return true;
    },
    closeSession: (id: string) => {
      log.push(`closeSession:${id}`);
      return true;
    },
    close: () => {
      log.push("close");
    },
  };
  holder.state = {
    catalog: [rec(A), rec(B)],
    childSessions: {},
    sessionRoles: {},
    sessionProvenance: { [A]: "local", [B]: "local" },
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
    poolEntries: [{ sessionId: B, live: true, status: "idle" }] as never,
    viewingSessionId: A,
    activeSessionId: A,
    session: { ...createSessionState({ id: A, workspace: "/proj" }), timeline: rec(A).timeline },
    connectionMode: "live-bridge",
    bridgeInfo: "",
    lastError: null,
    live: live as never,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: null,
    viewingSubagent: false,
    viewingParentSessionId: undefined,
    promptQueue: [],
    clearPendingMode: () => undefined,
  };
  return {
    get: () => holder.state as SessionStore,
    set: (partial) => {
      const patch =
        typeof partial === "function"
          ? (partial as (s: SessionStore) => Partial<SessionStore>)(holder.state as SessionStore)
          : (partial as Partial<SessionStore>);
      holder.state = { ...holder.state, ...patch };
    },
    log,
  };
}

describe("navigation flushes coalesced stream notifies", () => {
  it("selectSessionAction flushes while the old session is still viewed", () => {
    const store = makeStore();
    selectSessionAction(store.set as never, store.get as never, B);
    assert.equal(store.log[0], `flush:viewing=${A}:mode=live-bridge`);
    assert.equal(store.get().viewingSessionId, B);
  });

  it("newSessionAction flushes before the draft blanks the canvas", async () => {
    const store = makeStore();
    await newSessionAction(store.set as never, store.get as never, "/proj");
    assert.equal(store.log[0], `flush:viewing=${A}:mode=live-bridge`);
    assert.equal(store.get().viewingSessionId, null);
  });

  it("removeSessionAction flushes before closing and filtering the row", () => {
    const store = makeStore();
    removeSessionAction(store.set as never, store.get as never, B);
    assert.deepEqual(store.log.slice(0, 2), [
      `flush:viewing=${A}:mode=live-bridge`,
      `closeSession:${B}`,
    ]);
  });

  it("disconnectAction flushes before the socket closes", () => {
    const store = makeStore();
    disconnectAction(store.set as never, store.get as never);
    assert.deepEqual(store.log, [`flush:viewing=${A}:mode=live-bridge`, "close"]);
    assert.equal(store.get().connectionMode, "disconnected");
  });
});
