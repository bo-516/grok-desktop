/**
 * Cold-open disk hydrate: paints chat_history before session/load.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createSessionState,
  userTextFromBlocks,
} from "@grok-desktop/acp-core";
import { resetCatalogPersistHooksForTests } from "@/store/catalogPersistQueue";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import {
  hydrateViewingSessionFromDisk,
  prefetchSessionHistoryIntoCatalog,
} from "@/store/sessionStoreHistory";
import type { SessionStore } from "@/store/sessionStoreTypes";

/** In-memory localStorage so applyInbound persist does not throw. */
function installLocalStorage(): void {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    },
    configurable: true,
    writable: true,
  });
}

/**
 * Minimal store harness for hydrateViewingSessionFromDisk.
 * @param partial Initial store fields.
 */
function makeHarness(partial: Partial<SessionStore>) {
  let state = {
    session: createSessionState({ id: "s1", workspace: "/work", mode: "build" }),
    connectionMode: "live-bridge" as const,
    bridgeInfo: "",
    lastError: null as string | null,
    live: null as SessionStore["live"],
    catalog: [] as SessionStore["catalog"],
    activeSessionId: "s1" as string | null,
    viewingSessionId: "s1" as string | null,
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
    restoringSessionId: "s1" as string | null,
    promptQueue: [],
    restartNotice: null,
    ...partial,
  } as unknown as SessionStore;

  const set = (
    partialOrFn:
      | Partial<SessionStore>
      | ((s: SessionStore) => Partial<SessionStore>),
  ) => {
    const next =
      typeof partialOrFn === "function" ? partialOrFn(state) : partialOrFn;
    state = { ...state, ...next };
  };
  const get = () => state;
  return { set, get, getState: () => state };
}

describe("hydrateViewingSessionFromDisk", () => {
  beforeEach(() => {
    installLocalStorage();
    resetCatalogPersistHooksForTests();
  });

  afterEach(() => {
    resetCatalogPersistHooksForTests();
  });

  it("paints chat_history and clears restoring", async () => {
    const h = makeHarness({
      live: {
        cli: async () => ({
          ok: true,
          data: {
            sessionId: "s1",
            cwd: "/work",
            chatHistory: [
              {
                type: "user",
                content: [
                  { type: "text", text: "<user_query>\nhello disk\n</user_query>" },
                ],
              },
              { type: "assistant", content: "from disk" },
            ],
            updates: [],
          },
        }),
        seedSession: () => undefined,
      } as unknown as SessionStore["live"],
    });
    const ok = await hydrateViewingSessionFromDisk(h.set, h.get, {
      sessionId: "s1",
      cwd: "/work",
    });
    assert.equal(ok, true);
    const session = h.getState().session;
    assert.equal(session.id, "s1");
    const users = session.timeline.filter((item) => item.kind === "user");
    assert.equal(users.length, 1);
    assert.equal(userTextFromBlocks(users[0]!.blocks), "hello disk");
    assert.equal(h.getState().restoringSessionId, null);
  });

  it("no-ops when the user already switched away", async () => {
    let cliCalls = 0;
    const h = makeHarness({
      viewingSessionId: "other",
      live: {
        cli: async () => {
          cliCalls += 1;
          return { ok: true, data: { chatHistory: [], updates: [] } };
        },
        seedSession: () => undefined,
      } as unknown as SessionStore["live"],
    });
    const ok = await hydrateViewingSessionFromDisk(h.set, h.get, {
      sessionId: "s1",
      cwd: "/work",
    });
    assert.equal(ok, false);
    assert.equal(cliCalls, 0);
    assert.equal(h.getState().session.timeline.length, 0);
    assert.equal(h.getState().restoringSessionId, "s1");
  });

  it("skips fetch when the canvas already has conversation content", async () => {
    let cliCalls = 0;
    const seeded = createSessionState({
      id: "s1",
      workspace: "/work",
      mode: "build",
    });
    seeded.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "cached" }],
        origin: "seed",
      },
    ];
    const h = makeHarness({
      session: seeded,
      restoringSessionId: "s1",
      live: {
        cli: async () => {
          cliCalls += 1;
          return { ok: true, data: {} };
        },
      } as unknown as SessionStore["live"],
    });
    const ok = await hydrateViewingSessionFromDisk(h.set, h.get, {
      sessionId: "s1",
    });
    assert.equal(ok, true);
    assert.equal(cliCalls, 0);
    assert.equal(h.getState().restoringSessionId, null);
  });
});

/** Minimal catalog row in the shape sessions_list produces (empty timeline). */
function coldCatalogRow(id: string): SessionRecord {
  return {
    id,
    workspace: "/work",
    title: "cold chat",
    mode: "build",
    model: "grok-test",
    status: "idle",
    createdAt: 1,
    updatedAt: 1,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

/**
 * session_history response carrying one user+assistant exchange so the
 * catalog row can be seeded without touching the canvas.
 * @param id Session id the payload claims.
 */
function historyPayload(id: string) {
  return {
    ok: true,
    data: {
      sessionId: id,
      cwd: "/work",
      chatHistory: [
        {
          type: "user",
          content: [
            { type: "text", text: "<user_query>\nhi\n</user_query>" },
          ],
        },
        { type: "assistant", content: "warm body" },
      ],
      updates: [],
    },
  };
}

/** Let the fire-and-forget prefetch promise chain settle. */
function flushPrefetch(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("prefetchSessionHistoryIntoCatalog", () => {
  beforeEach(() => {
    installLocalStorage();
    resetCatalogPersistHooksForTests();
  });

  afterEach(() => {
    resetCatalogPersistHooksForTests();
  });

  it("warms a cold catalog row without touching the canvas", async () => {
    const row = coldCatalogRow("s-p1");
    const h = makeHarness({
      catalog: [row],
      live: {
        cli: async () => historyPayload("s-p1"),
      } as unknown as SessionStore["live"],
    });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p1" });
    await flushPrefetch();
    const warmed = h.getState().catalog.find((r) => r.id === "s-p1");
    assert.ok(warmed, "row still in catalog");
    assert.ok(
      warmed!.timeline.length > 0,
      "prefetched history seeded the row timeline",
    );
    // The viewed canvas and selection are untouched — prefetch is catalog-only.
    assert.equal(h.getState().viewingSessionId, "s1");
    assert.equal(h.getState().session.id, "s1");
    assert.equal(h.getState().session.timeline.length, 0);
  });

  it("does not refetch a row that already has a timeline", async () => {
    let cliCalls = 0;
    const row = coldCatalogRow("s-p2");
    row.timeline = [
      {
        kind: "user",
        id: "u1",
        blocks: [{ type: "text", text: "cached" }],
        origin: "seed",
      },
    ];
    const h = makeHarness({
      catalog: [row],
      live: {
        cli: async () => {
          cliCalls += 1;
          return historyPayload("s-p2");
        },
      } as unknown as SessionStore["live"],
    });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p2" });
    await flushPrefetch();
    assert.equal(cliCalls, 0);
    assert.equal(h.getState().catalog[0]!.timeline.length, 1);
  });

  it("leaves the viewed session to select's own hydrate path", async () => {
    let cliCalls = 0;
    const row = coldCatalogRow("s-p3");
    const h = makeHarness({
      catalog: [row],
      viewingSessionId: "s-p3",
      live: {
        cli: async () => {
          cliCalls += 1;
          return historyPayload("s-p3");
        },
      } as unknown as SessionStore["live"],
    });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p3" });
    await flushPrefetch();
    assert.equal(cliCalls, 0);
  });

  it("no-ops when the bridge is not connected", async () => {
    const h = makeHarness({
      catalog: [coldCatalogRow("s-p4")],
      live: null,
    });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p4" });
    await flushPrefetch();
    assert.equal(h.getState().catalog[0]!.timeline.length, 0);
  });

  it("dedupes a hover sweep while one fetch is in flight", async () => {
    let cliCalls = 0;
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const h = makeHarness({
      catalog: [coldCatalogRow("s-p5")],
      live: {
        cli: async () => {
          cliCalls += 1;
          return pending;
        },
      } as unknown as SessionStore["live"],
    });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p5" });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p5" });
    assert.equal(cliCalls, 1);
    release(historyPayload("s-p5"));
    await flushPrefetch();
  });

  it("does not write the catalog when the user already clicked through", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const h = makeHarness({
      catalog: [coldCatalogRow("s-p6")],
      live: {
        cli: async () => pending,
      } as unknown as SessionStore["live"],
    });
    prefetchSessionHistoryIntoCatalog(h.set, h.get, { sessionId: "s-p6" });
    // Clicked mid-flight: select seeded the canvas; its hydrate owns the row.
    h.set({ viewingSessionId: "s-p6" });
    release(historyPayload("s-p6"));
    await flushPrefetch();
    assert.equal(h.getState().catalog[0]!.timeline.length, 0);
  });
});
