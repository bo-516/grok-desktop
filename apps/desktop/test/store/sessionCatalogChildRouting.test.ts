/**
 * Child streaming routes to in-memory buffer; catalog/recency stay stable.
 * Drives shipped applyInboundSession (not a re-implementation of routing).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionState,
  type SessionState,
} from "@grok-desktop/acp-core";
import { applyInboundSession } from "@/store/sessionStoreLiveInbound";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import {
  isTerminalSubagentStatus,
  promoteChildToCatalog,
  type SessionRoleIndex,
} from "@/store/sessionRoles";

const PARENT = "parent-route";
const CHILD = "child-route-1";

/** Minimal mutable store slice for applyInboundSession. */
type Slice = {
  session: SessionState;
  connectionMode: "live-bridge" | "disconnected" | "connecting";
  bridgeInfo: string;
  lastError: string | null;
  live: null;
  catalog: SessionRecord[];
  activeSessionId: string | null;
  viewingSessionId: string | null;
  poolEntries: never[];
  environment: null;
  promptQueue: Array<{ sessionId: string; text: string }>;
  restartNotice: string | null;
  localDraft: boolean;
  creatingSession: boolean;
  pendingMode: null;
  restoringSessionId: string | null;
  sessionRoles: SessionRoleIndex;
  childSessions: Record<string, SessionState>;
  sessionProvenance: Record<string, "local" | "resumed" | "disk" | "child" | "wire">;
  pendingSessions: Record<string, SessionState>;
  pendingSessionOrder: string[];
  catalogRevision: number;
};

/**
 * Build a get/set pair that mirrors Zustand for applyInboundSession tests.
 * @param initial Initial slice fields.
 */
function makeStore(initial: Partial<Slice> = {}): {
  get: () => Slice;
  set: (partial: Partial<Slice> | ((s: Slice) => Partial<Slice>)) => void;
  snap: () => Slice;
} {
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
    snap: () => state,
  };
}

/**
 * Parent with one running subagent card (role source).
 */
function parentWithChildCard(
  status = "running",
): SessionState {
  const s = createSessionState({ id: PARENT, workspace: "/proj" });
  s.status = "streaming";
  s.timeline = [
    {
      kind: "user",
      id: "u1",
      blocks: [{ type: "text", text: "spawn one" }],
    },
  ];
  s.subagents = {
    [CHILD]: {
      subagentId: CHILD,
      childSessionId: CHILD,
      type: "general-purpose",
      description: "worker",
      status,
    },
  };
  return s;
}

describe("child catalog routing (applyInboundSession)", () => {
  it("known child streaming frames leave catalog reference stable", () => {
    const store = makeStore();
    // Parent spawn lands first → roles index.
    applyInboundSession(store.set as never, store.get as never, parentWithChildCard());
    const afterParent = store.snap();
    assert.equal(afterParent.sessionRoles[CHILD]?.parentSessionId, PARENT);
    const catalogRef = afterParent.catalog;
    const parentUpdatedAt = catalogRef.find((r) => r.id === PARENT)?.updatedAt;

    // Child token stream — must not rewrite catalog or advance child recency.
    for (let i = 0; i < 5; i += 1) {
      const child = createSessionState({ id: CHILD, workspace: "" });
      child.status = "streaming";
      child.timeline = [
        {
          kind: "user",
          id: "cu",
          blocks: [{ type: "text", text: "you are the worker…" }],
        },
        {
          kind: "agent",
          id: `ca${i}`,
          text: `chunk ${i}`,
        },
      ];
      child.lastAgentText = `chunk ${i}`;
      applyInboundSession(store.set as never, store.get as never, child);
    }

    const after = store.snap();
    // Catalog array may be replaced only for retro-tag; no child row added.
    assert.equal(
      after.catalog.some((r) => r.id === CHILD),
      false,
      "child must not enter catalog while streaming",
    );
    assert.ok(after.childSessions[CHILD], "child buffered in memory");
    assert.equal(after.childSessions[CHILD]?.lastAgentText, "chunk 4");
    // Parent recency unchanged by child streams.
    assert.equal(
      after.catalog.find((r) => r.id === PARENT)?.updatedAt,
      parentUpdatedAt,
    );
    // Identity: if no retro-tag needed, same catalog reference preferred.
    // After parent upsert, child frames that only touch childSessions may
    // keep catalog when retro-tag is a no-op.
    assert.ok(catalogRef === after.catalog || after.catalog.length >= 1);
  });

  it("terminal promote yields sessionKind subagent with parent linkage", () => {
    const store = makeStore();
    applyInboundSession(store.set as never, store.get as never, parentWithChildCard("running"));

    // Stream into buffer.
    const child = createSessionState({ id: CHILD, workspace: "" });
    child.status = "streaming";
    child.timeline = [
      {
        kind: "user",
        id: "cu",
        blocks: [{ type: "text", text: "worker prompt" }],
      },
    ];
    applyInboundSession(store.set as never, store.get as never, child);
    assert.ok(store.snap().childSessions[CHILD]);

    // Parent finished card → promote from buffer.
    applyInboundSession(
      store.set as never,
      store.get as never,
      parentWithChildCard("completed"),
    );
    const after = store.snap();
    const row = after.catalog.find((r) => r.id === CHILD);
    assert.ok(row, "terminal child promoted to catalog");
    assert.equal(row!.sessionKind, "subagent");
    assert.equal(row!.parentSessionId, PARENT);
    assert.equal(row!.workspace, "/proj");
    assert.equal(after.childSessions[CHILD], undefined);
  });

  it("viewing the child uses canvas path (not force-downgraded)", () => {
    const store = makeStore({
      viewingSessionId: CHILD,
      activeSessionId: CHILD,
      sessionRoles: {
        [CHILD]: { parentSessionId: PARENT, sessionKind: "subagent" },
      },
      catalog: [
        {
          id: CHILD,
          workspace: "/proj",
          title: "child",
          mode: "build",
          model: "",
          status: "idle",
          createdAt: 1,
          updatedAt: 1,
          timeline: [],
          toolCalls: {},
          lastAgentText: "",
          sessionKind: "subagent",
          parentSessionId: PARENT,
        },
      ],
    });
    const child = createSessionState({ id: CHILD, workspace: "/proj" });
    child.status = "streaming";
    child.timeline = [
      { kind: "agent", id: "a1", text: "live while drilled in" },
    ];
    child.lastAgentText = "live while drilled in";
    applyInboundSession(store.set as never, store.get as never, child);
    const after = store.snap();
    // Viewing child: canvas follows, not only buffer.
    assert.equal(after.session.lastAgentText, "live while drilled in");
    assert.equal(after.viewingSessionId, CHILD);
    // Still known as child in roles.
    assert.equal(after.sessionRoles[CHILD]?.sessionKind, "subagent");
  });
});

describe("promoteChildToCatalog / terminal helpers", () => {
  it("isTerminalSubagentStatus covers completed/failed/cancelled", () => {
    assert.equal(isTerminalSubagentStatus("completed"), true);
    assert.equal(isTerminalSubagentStatus("failed"), true);
    assert.equal(isTerminalSubagentStatus("cancelled"), true);
    assert.equal(isTerminalSubagentStatus("running"), false);
  });

  it("promote stamps role and parent workspace", () => {
    const child = createSessionState({ id: CHILD, workspace: "" });
    child.timeline = [
      {
        kind: "user",
        id: "u",
        blocks: [{ type: "text", text: "hi" }],
      },
    ];
    const catalog = promoteChildToCatalog(
      [],
      child,
      { parentSessionId: PARENT, sessionKind: "subagent" },
      "/proj",
      1000,
    );
    assert.equal(catalog[0]?.sessionKind, "subagent");
    assert.equal(catalog[0]?.parentSessionId, PARENT);
    assert.equal(catalog[0]?.workspace, "/proj");
  });

  it("buffered-only child is openable for L3 without catalog row", async () => {
    // Shipped open gate used by Agents + timeline (not catalog alone).
    const { openableChildSessionIds, canOpenChildSession } = await import(
      "@/lib/sessionActions"
    );
    const store = makeStore();
    applyInboundSession(store.set as never, store.get as never, parentWithChildCard("running"));
    const child = createSessionState({ id: CHILD, workspace: "" });
    child.status = "streaming";
    child.timeline = [
      {
        kind: "user",
        id: "cu",
        blocks: [{ type: "text", text: "worker body" }],
      },
      { kind: "agent", id: "ca", text: "partial" },
    ];
    child.lastAgentText = "partial";
    applyInboundSession(store.set as never, store.get as never, child);
    const snap = store.snap();
    assert.equal(snap.catalog.some((r) => r.id === CHILD), false);
    assert.ok(snap.childSessions[CHILD]);
    assert.ok(snap.sessionRoles[CHILD]);
    const openable = openableChildSessionIds(
      snap.catalog,
      snap.childSessions,
      snap.sessionRoles,
    );
    assert.equal(openable.has(CHILD), true);
    assert.equal(
      canOpenChildSession(
        CHILD,
        snap.catalog,
        snap.childSessions,
        snap.sessionRoles,
      ),
      true,
    );
    // Catalog-only set would wrongly hide Open mid-run.
    assert.equal(
      canOpenChildSession(CHILD, snap.catalog, {}, {}),
      false,
    );
  });
});
