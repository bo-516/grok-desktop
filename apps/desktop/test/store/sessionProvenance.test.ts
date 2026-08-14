/**
 * Provenance admission: wire-only ids stay pending; local/resumed/disk enter
 * catalog; spawn / sessions_list / disconnect flush claim pending without loss.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import {
  admitForceNewSessionFromInfo,
  applyInboundSession,
} from "@/store/sessionStoreLiveInbound";
import {
  flushPendingSessionsToCatalog,
  syncCatalogFromBridge,
} from "@/store/sessionStoreLive";
import {
  isUserFacingProvenance,
  shouldStampLocalFromForceNewInfo,
  stampProvenance,
  type SessionProvenanceIndex,
} from "@/store/sessionProvenance";
import {
  rolesFromRemoteRows,
  type SessionRoleIndex,
} from "@/store/sessionRoles";
import { filterCatalogForSessionRail } from "@/lib/sessionActions";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { LiveHandle } from "@/store/sessionStoreLiveTypes";

type Slice = {
  session: SessionState;
  connectionMode: "live-bridge";
  bridgeInfo: string;
  lastError: null;
  live: null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: never[];
  environment: null;
  promptQueue: never[];
  restartNotice: null;
  localDraft: boolean;
  creatingSession: boolean;
  pendingMode: null;
  restoringSessionId: null;
  sessionRoles: SessionRoleIndex;
  childSessions: Record<string, SessionState>;
  sessionProvenance: SessionProvenanceIndex;
  pendingSessions: Record<string, SessionState>;
  pendingSessionOrder: string[];
  catalogRevision: number;
};

/**
 * Minimal store double for applyInboundSession.
 * @param initial Partial initial state.
 */
function makeStore(initial: Partial<Slice> = {}): {
  get: () => Slice;
  set: (p: Partial<Slice> | ((s: Slice) => Partial<Slice>)) => void;
  snap: () => Slice;
} {
  let state: Slice = {
    session: createSessionState({ id: "parent", workspace: "/w" }),
    connectionMode: "live-bridge",
    bridgeInfo: "",
    lastError: null,
    live: null,
    catalog: [],
    activeSessionId: "parent",
    viewingSessionId: "parent",
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
    sessionProvenance: stampProvenance({}, "parent", "local"),
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
    snap: () => state,
  };
}

describe("session provenance admission", () => {
  it("isUserFacingProvenance only for local/resumed/disk", () => {
    assert.equal(isUserFacingProvenance("local"), true);
    assert.equal(isUserFacingProvenance("resumed"), true);
    assert.equal(isUserFacingProvenance("disk"), true);
    assert.equal(isUserFacingProvenance("child"), false);
    assert.equal(isUserFacingProvenance("wire"), false);
    assert.equal(isUserFacingProvenance(undefined), false);
  });

  it("untagged wire id first frame → pending, catalog ref unchanged", () => {
    const store = makeStore();
    const catalogRef = store.snap().catalog;
    const child = createSessionState({
      id: "wire-child-1",
      workspace: "",
    });
    child.status = "streaming";
    child.lastAgentText = "hello";
    applyInboundSession(store.set as never, store.get as never, child);
    const s = store.snap();
    assert.ok(s.pendingSessions["wire-child-1"]);
    assert.equal(s.catalog, catalogRef);
    assert.equal(filterCatalogForSessionRail(s.catalog).length, 0);
  });

  it("local-stamped id enters catalog", () => {
    const store = makeStore({
      sessionProvenance: stampProvenance({}, "user-1", "local"),
      viewingSessionId: "user-1",
      activeSessionId: "user-1",
      session: createSessionState({ id: "user-1", workspace: "/w" }),
    });
    const sess = createSessionState({ id: "user-1", workspace: "/w" });
    sess.timeline = [
      { id: "t1", kind: "user", blocks: [{ type: "text", text: "hi" }] },
    ];
    applyInboundSession(store.set as never, store.get as never, sess);
    assert.ok(store.snap().catalog.some((r) => r.id === "user-1"));
    assert.equal(store.snap().pendingSessions["user-1"], undefined);
  });

  it("resumed-stamped id enters catalog", () => {
    const store = makeStore({
      sessionProvenance: stampProvenance({}, "user-2", "resumed"),
      viewingSessionId: "user-2",
    });
    applyInboundSession(
      store.set as never,
      store.get as never,
      createSessionState({ id: "user-2", workspace: "/w" }),
    );
    assert.ok(store.snap().catalog.some((r) => r.id === "user-2"));
  });

  it("pending claimed by subagent_spawned → childSessions", () => {
    const store = makeStore();
    // Child frame first (wire).
    applyInboundSession(
      store.set as never,
      store.get as never,
      createSessionState({ id: "child-1", workspace: "" }) ,
    );
    assert.ok(store.snap().pendingSessions["child-1"]);

    // Parent spawn claims the child.
    const parent = createSessionState({ id: "parent", workspace: "/w" });
    parent.subagents = {
      sa1: {
        subagentId: "sa1",
        childSessionId: "child-1",
        status: "running",
        type: "general-purpose",
        description: "w",
      },
    };
    applyInboundSession(store.set as never, store.get as never, parent);
    const s = store.snap();
    assert.equal(s.pendingSessions["child-1"], undefined);
    assert.ok(s.childSessions["child-1"] || s.sessionRoles["child-1"]);
    assert.equal(s.sessionProvenance["child-1"], "child");
  });

  it("creatingSession + wire child with body does not stamp local or pollute rail", () => {
    // forceNew in flight on draft canvas; background wire child must stay pending.
    const parentRow: SessionRecord = {
      id: "parent-open",
      workspace: "/w",
      title: "Open parent",
      mode: "build",
      model: "",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
      timeline: [
        { id: "u", kind: "user", blocks: [{ type: "text", text: "hi" }] },
      ],
      toolCalls: {},
      lastAgentText: "",
    };
    const store = makeStore({
      // Draft forceNew: empty canvas id, localDraft + creatingSession.
      session: createSessionState({ id: "", workspace: "/w" }),
      catalog: [parentRow],
      activeSessionId: null,
      viewingSessionId: null,
      localDraft: true,
      creatingSession: true,
      sessionProvenance: stampProvenance({}, "parent-open", "local"),
    });
    const baselineRail = filterCatalogForSessionRail(store.snap().catalog).length;
    assert.equal(baselineRail, 1);

    const wireChild = createSessionState({
      id: "wire-child-race",
      workspace: "",
    });
    wireChild.status = "streaming";
    wireChild.lastAgentText = "subagent output mid forceNew";
    wireChild.timeline = [
      {
        id: "a1",
        kind: "agent",
        text: "subagent output mid forceNew",
      },
    ];
    applyInboundSession(store.set as never, store.get as never, wireChild);
    const s = store.snap();
    assert.ok(
      s.pendingSessions["wire-child-race"],
      "wire child must land in pending",
    );
    assert.notEqual(
      s.sessionProvenance["wire-child-race"],
      "local",
      "must not race-stamp local during forceNew",
    );
    assert.equal(
      filterCatalogForSessionRail(s.catalog).length,
      baselineRail,
      "rail must stay at pre-fanout baseline",
    );
    assert.equal(
      s.catalog.some((r) => r.id === "wire-child-race"),
      false,
      "wire child must not enter catalog",
    );
  });

  it("empty handshake-shaped wire during forceNew stays pending (not local)", () => {
    // Same empty-timeline shape as real forceNew state — must NOT stamp local
    // or paint canvas; only bridge info sessionId may stamp local.
    const parentRow: SessionRecord = {
      id: "parent-open",
      workspace: "/w",
      title: "Open parent",
      mode: "build",
      model: "",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
      timeline: [
        { id: "u", kind: "user", blocks: [{ type: "text", text: "hi" }] },
      ],
      toolCalls: {},
      lastAgentText: "",
    };
    const store = makeStore({
      session: createSessionState({ id: "", workspace: "/w" }),
      catalog: [parentRow],
      activeSessionId: null,
      viewingSessionId: null,
      localDraft: true,
      creatingSession: true,
      sessionProvenance: stampProvenance({}, "parent-open", "local"),
    });
    const baselineRail = filterCatalogForSessionRail(store.snap().catalog).length;
    const emptyWire = createSessionState({
      id: "empty-wire-id",
      workspace: "/w",
    });
    // Empty timeline — identical shape to Go/Node forceNew empty state.
    emptyWire.timeline = [];
    emptyWire.status = "idle";
    emptyWire.lastAgentText = "";
    applyInboundSession(store.set as never, store.get as never, emptyWire);
    const s = store.snap();
    assert.ok(s.pendingSessions["empty-wire-id"], "empty wire → pending");
    assert.notEqual(
      s.sessionProvenance["empty-wire-id"],
      "local",
      "empty inbound must not stamp local",
    );
    assert.equal(s.session.id, "", "canvas id must stay empty (not hijacked)");
    assert.equal(
      filterCatalogForSessionRail(s.catalog).length,
      baselineRail,
    );
    assert.equal(
      s.catalog.some((r) => r.id === "empty-wire-id"),
      false,
    );

    // Follow-up content frame still isolated (no local sticky).
    emptyWire.timeline = [
      { id: "a", kind: "agent", text: "later content" },
    ];
    emptyWire.lastAgentText = "later content";
    applyInboundSession(store.set as never, store.get as never, emptyWire);
    const s2 = store.snap();
    assert.equal(
      filterCatalogForSessionRail(s2.catalog).length,
      baselineRail,
      "content follow-up must not pollute rail",
    );
    assert.equal(s2.sessionProvenance["empty-wire-id"] === "local", false);
  });

  it("shouldStampLocalFromForceNewInfo requires ready message contract", () => {
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: true,
        localDraft: true,
        sessionId: "new-1",
        message: "session new-1 ready",
      }),
      true,
    );
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: true,
        localDraft: true,
        sessionId: "new-1",
        message: 'session new-1 ready (models=["grok-4.5"])',
      }),
      true,
    );
    // Bare sessionId without ready text — reject (ops/recovery leak surface).
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: true,
        localDraft: true,
        sessionId: "wire-other",
        message: "agent process exited (code 1); recovering via session/load…",
      }),
      false,
    );
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: true,
        localDraft: true,
        sessionId: "wire-other",
        message: "restarted session wire-other with updated SPAWN settings",
      }),
      false,
    );
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: true,
        localDraft: true,
        sessionId: "new-1",
        message: undefined,
      }),
      false,
    );
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: true,
        localDraft: true,
        sessionId: undefined,
        message: "session new-1 ready",
      }),
      false,
    );
    assert.equal(
      shouldStampLocalFromForceNewInfo({
        creatingSession: false,
        localDraft: true,
        sessionId: "new-1",
        message: "session new-1 ready",
      }),
      false,
    );
  });

  it("mid-forceNew non-ready info for unrelated sessionId does not stamp local or grow rail", () => {
    const parentRow: SessionRecord = {
      id: "parent-open",
      workspace: "/w",
      title: "Open parent",
      mode: "build",
      model: "",
      status: "idle",
      createdAt: 1,
      updatedAt: 2,
      timeline: [
        { id: "u", kind: "user", blocks: [{ type: "text", text: "hi" }] },
      ],
      toolCalls: {},
      lastAgentText: "",
    };
    const store = makeStore({
      session: createSessionState({ id: "", workspace: "/w" }),
      catalog: [parentRow],
      activeSessionId: null,
      viewingSessionId: null,
      localDraft: true,
      creatingSession: true,
      sessionProvenance: stampProvenance({}, "parent-open", "local"),
    });
    const baselineRail = filterCatalogForSessionRail(store.snap().catalog).length;
    assert.equal(baselineRail, 1);

    // Recovery/ops-style info with an unrelated pool id mid-forceNew.
    assert.equal(
      admitForceNewSessionFromInfo(
        store.set as never,
        store.get as never,
        "wire-other",
        "agent process exited (code 1); recovering via session/load…",
      ),
      false,
    );
    assert.notEqual(store.snap().sessionProvenance["wire-other"], "local");

    // Content frame for that unrelated id must stay out of the rail.
    const other = createSessionState({ id: "wire-other", workspace: "/w" });
    other.timeline = [
      { id: "a", kind: "agent", text: "unrelated pool content" },
    ];
    other.lastAgentText = "unrelated pool content";
    applyInboundSession(store.set as never, store.get as never, other);
    const s = store.snap();
    assert.ok(s.pendingSessions["wire-other"]);
    assert.notEqual(s.sessionProvenance["wire-other"], "local");
    assert.equal(
      filterCatalogForSessionRail(s.catalog).length,
      baselineRail,
      "rail must not grow with wire-other",
    );
    assert.equal(
      s.catalog.some((r) => r.id === "wire-other"),
      false,
    );
  });

  it("admitForceNewSessionFromInfo stamps local on ready message and re-admits pending", () => {
    const store = makeStore({
      session: createSessionState({ id: "", workspace: "/w" }),
      catalog: [],
      activeSessionId: null,
      viewingSessionId: null,
      localDraft: true,
      creatingSession: true,
      sessionProvenance: {},
    });
    // State frame arrived before info → pending.
    const handshake = createSessionState({ id: "force-new-1", workspace: "/w" });
    handshake.timeline = [];
    applyInboundSession(store.set as never, store.get as never, handshake);
    assert.ok(store.snap().pendingSessions["force-new-1"]);
    assert.equal(store.snap().session.id, "");

    // Bridge info: session force-new-1 ready (Node/Go handshake contract).
    assert.equal(
      admitForceNewSessionFromInfo(
        store.set as never,
        store.get as never,
        "force-new-1",
        "session force-new-1 ready (models=[\"grok-4.5\"])",
      ),
      true,
    );
    const s = store.snap();
    assert.equal(s.sessionProvenance["force-new-1"], "local");
    assert.equal(s.pendingSessions["force-new-1"], undefined);
    // Re-admission paints canvas / catalog for the real forceNew id.
    assert.equal(s.session.id, "force-new-1");
    assert.ok(s.catalog.some((r) => r.id === "force-new-1"));
  });

  it("child provenance can reclaim race-stamped local", () => {
    const index = stampProvenance({}, "c1", "local");
    const next = stampProvenance(index, "c1", "child");
    assert.equal(next.c1, "child");
  });

  it("sessions_list without subagent kind promotes pending via shipped syncCatalogFromBridge", async () => {
    // Drive the real sync entry with a fake bridge.cli — not a reimplementation.
    const other = createSessionState({
      id: "other-client",
      workspace: "/w",
    });
    other.timeline = [
      { id: "t", kind: "user", blocks: [{ type: "text", text: "remote" }] },
    ];
    other.title = "Other client chat";
    const store = makeStore({
      pendingSessions: { "other-client": other },
      pendingSessionOrder: ["other-client"],
      sessionProvenance: {},
      catalog: [],
    });
    const bridge = {
      cli: async (command: string) => {
        assert.equal(command, "sessions_list");
        return {
          ok: true,
          data: {
            sessions: [
              {
                id: "other-client",
                title: "Other client chat",
                cwd: "/w",
                // no session_kind → ordinary user chat
              },
            ],
          },
        };
      },
    } as unknown as LiveHandle;

    const result = await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(result.ok, true);
    const s = store.snap();
    assert.equal(s.pendingSessions["other-client"], undefined);
    assert.ok(s.catalog.some((r) => r.id === "other-client"));
    assert.equal(s.sessionProvenance["other-client"], "disk");
    assert.ok(
      filterCatalogForSessionRail(s.catalog).some((r) => r.id === "other-client"),
    );
  });

  it("disconnect flush promotes remaining pending without loss", () => {
    const catalog: SessionRecord[] = [];
    // Give pending sessions content so pruneEmptyWeakSessions keeps them.
    const a = createSessionState({ id: "a", workspace: "/w" });
    a.timeline = [
      { id: "t", kind: "user", blocks: [{ type: "text", text: "a" }] },
    ];
    a.title = "Session A";
    const b = createSessionState({ id: "b", workspace: "/w" });
    b.timeline = [
      { id: "t", kind: "user", blocks: [{ type: "text", text: "b" }] },
    ];
    b.title = "Session B";
    const pending: Record<string, SessionState> = { a, b };
    const { catalog: next, provenance } = flushPendingSessionsToCatalog(
      catalog,
      pending,
      {},
    );
    assert.equal(next.length, 2);
    assert.ok(next.some((r) => r.id === "a"));
    assert.ok(next.some((r) => r.id === "b"));
    assert.equal(provenance.a, "disk");
    assert.equal(provenance.b, "disk");
  });

  it("rolesFromRemoteRows registers subagent without parentSessionId", () => {
    const roles = rolesFromRemoteRows([
      {
        id: "c1",
        title: "child",
        sessionKind: "subagent",
      },
    ]);
    assert.ok(roles.c1);
    assert.equal(roles.c1.sessionKind, "subagent");
  });
});
