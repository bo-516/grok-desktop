/**
 * Store side of bridge-asserted provenance: children are routed by fact (no
 * pending buffer, no sessions_list claim), this window's own start is stamped
 * local, and foreign sessions keep the heuristic fallback. Drives shipped
 * applyBridgeProvenance / applyInboundSession / createLiveBridgeDispatch.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import { createLiveBridgeDispatch } from "@/bridge/liveBridgeDispatch";
import type { BridgeSessionProvenance } from "@/bridge/liveBridgeStreamTypes";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { SessionProvenanceIndex } from "@/store/sessionProvenance";
import type { SessionRoleIndex } from "@/store/sessionRoles";
import { applyBridgeProvenance } from "@/store/sessionStoreBridgeProvenance";
import { applyInboundSession } from "@/store/sessionStoreLiveInbound";

const PARENT = "parent-bp";
const CHILD = "child-bp";

/** Minimal mutable store slice for the live inbound path. */
type Slice = {
  session: SessionState;
  connectionMode: "live-bridge";
  bridgeInfo: string;
  lastError: string | null;
  live: null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: never[];
  environment: null;
  promptQueue: never[];
  restartNotice: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  pendingMode: null;
  restoringSessionId: string | null;
  sessionRoles: SessionRoleIndex;
  childSessions: Record<string, SessionState>;
  sessionProvenance: SessionProvenanceIndex;
  pendingSessions: Record<string, SessionState>;
  pendingSessionOrder: string[];
  catalogRevision: number;
};

/** Store handle: get / set mirroring Zustand plus typed casts for callers. */
type Store = {
  get: () => Slice;
  set: (partial: Partial<Slice> | ((s: Slice) => Partial<Slice>)) => void;
};

/**
 * Build a store viewing PARENT.
 * @param initial Fields overriding the defaults.
 */
function makeStore(initial: Partial<Slice> = {}): Store {
  let state: Slice = {
    session: createSessionState({ id: PARENT, workspace: "/proj" }),
    connectionMode: "live-bridge",
    bridgeInfo: "",
    lastError: null,
    live: null,
    catalog: [],
    activeSessionId: PARENT,
    viewingSessionId: PARENT,
    poolEntries: [],
    environment: null,
    promptQueue: [],
    restartNotice: null,
    localDraft: false,
    creatingSession: false,
    pendingMode: null,
    restoringSessionId: null,
    sessionRoles: {},
    childSessions: {},
    sessionProvenance: { [PARENT]: "local" },
    pendingSessions: {},
    pendingSessionOrder: [],
    catalogRevision: 0,
    ...initial,
  };
  return {
    get: () => state,
    set: (partial) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    },
  };
}

/**
 * Apply one assertion against the store.
 * @param store Test store. @param id Session id. @param p Provenance.
 */
function assertProvenance(store: Store, id: string, p: BridgeSessionProvenance): void {
  applyBridgeProvenance(store.set as never, store.get as never, id, p);
}

/**
 * Session with one agent line.
 * @param id Session id. @param text Agent text.
 */
function withText(id: string, text: string): SessionState {
  return {
    ...createSessionState({ id, workspace: "/proj" }),
    lastAgentText: text,
    timeline: [{ kind: "agent", id: `${id}-a`, text }],
  } as SessionState;
}

describe("applyBridgeProvenance", () => {
  it("child: claims a pending buffer into childSessions with role + stamp", () => {
    const buffered = withText(CHILD, "early");
    const store = makeStore({
      pendingSessions: { [CHILD]: buffered },
      pendingSessionOrder: [CHILD],
    });
    assertProvenance(store, CHILD, {
      kind: "child",
      parentSessionId: PARENT,
      own: false,
    });
    const s = store.get();
    assert.deepEqual(s.pendingSessions, {});
    assert.deepEqual(s.pendingSessionOrder, []);
    assert.equal(s.childSessions[CHILD], buffered);
    assert.deepEqual(s.sessionRoles[CHILD], {
      parentSessionId: PARENT,
      sessionKind: "subagent",
    });
    assert.equal(s.sessionProvenance[CHILD], "child");
  });

  it("child: keeps a role the parent's own subagent cards already gave", () => {
    const store = makeStore({
      sessionRoles: { [CHILD]: { parentSessionId: "mid", sessionKind: "subagent" } },
    });
    assertProvenance(store, CHILD, { kind: "child", parentSessionId: PARENT, own: false });
    assert.equal(store.get().sessionRoles[CHILD]?.parentSessionId, "mid");
  });

  it("child: never downgrades an explicit user open (resumed)", () => {
    const store = makeStore({ sessionProvenance: { [CHILD]: "resumed" } });
    assertProvenance(store, CHILD, { kind: "resumed", parentSessionId: PARENT, own: true });
    assert.equal(store.get().sessionProvenance[CHILD], "resumed");
    assert.ok(store.get().sessionRoles[CHILD], "lineage still recorded as role");
  });

  it("own start: stamps local and re-admits a frame that raced in as wire", () => {
    const fresh = createSessionState({ id: "new-1", workspace: "/proj" });
    const store = makeStore({
      localDraft: true,
      creatingSession: true,
      viewingSessionId: null,
      activeSessionId: null,
      pendingSessions: { "new-1": fresh },
      pendingSessionOrder: ["new-1"],
    });
    assertProvenance(store, "new-1", { kind: "started", startId: "x", own: true });
    const s = store.get();
    assert.equal(s.sessionProvenance["new-1"], "local");
    assert.deepEqual(s.pendingSessions, {});
    assert.ok(s.catalog.some((r) => r.id === "new-1"), "re-admitted into catalog");
    assert.equal(s.viewingSessionId, "new-1", "forceNew canvas follows its own session");
  });

  it("foreign start: untouched (pending fallback stays in charge)", () => {
    const store = makeStore();
    const before = store.get();
    assertProvenance(store, "theirs", { kind: "started", startId: "y", own: false });
    assert.equal(store.get(), before);
  });

  it("own resume fills in `resumed`", () => {
    const store = makeStore();
    assertProvenance(store, "old-1", { kind: "resumed", own: true });
    assert.equal(store.get().sessionProvenance["old-1"], "resumed");
  });
});

describe("dispatch + store: child frames before subagent_spawned", () => {
  it("route to childSessions directly — never pending, never the catalog", () => {
    const store = makeStore();
    const dispatch = createLiveBridgeDispatch({
      handlers: {
        onState: (s, meta) => {
          applyInboundSession(store.set as never, store.get as never, s, meta);
        },
        onSessionUpdate: (s) => {
          applyInboundSession(store.set as never, store.get as never, s);
        },
        onProvenance: (id, p) => {
          applyBridgeProvenance(store.set as never, store.get as never, id, p);
        },
      },
    });
    for (let seq = 1; seq <= 3; seq += 1) {
      dispatch.handleServerMsg({
        type: "session_update",
        sessionId: CHILD,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `k${seq} ` },
        },
        epoch: "e1",
        seq,
        provenance: { kind: "child", parentSessionId: PARENT },
      });
    }
    const s = store.get();
    assert.deepEqual(s.pendingSessions, {}, "no wire buffer to claim later");
    assert.equal(s.childSessions[CHILD]?.lastAgentText, "k1 k2 k3 ");
    assert.equal(s.sessionProvenance[CHILD], "child");
    assert.equal(s.catalog.length, 0, "child never enters the rail catalog");
  });
});
