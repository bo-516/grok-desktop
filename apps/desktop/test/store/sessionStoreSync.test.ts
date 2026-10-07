/**
 * sessions_list sync: a successful list replaces rail membership.
 * CLI failure keeps the in-memory rows so a dropped socket cannot blank them.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createSessionState } from "@grok-desktop/acp-core";
import { resetCatalogPersistHooksForTests } from "@/store/catalogPersistQueue";
import { upsertFromLiveState } from "@/store/sessionCatalog";
import { syncCatalogFromBridge } from "@/store/sessionStoreSync";
import type { SessionRecord } from "@/store/sessionCatalogTypes";
import type { LiveHandle } from "@/store/sessionStoreLiveTypes";

afterEach(() => {
  resetCatalogPersistHooksForTests();
});

type Slice = {
  catalog: SessionRecord[];
  sessionRoles: Record<string, unknown>;
  sessionProvenance: Record<string, string>;
  pendingSessions: Record<string, unknown>;
  pendingSessionOrder: string[];
  childSessions: Record<string, unknown>;
  catalogRevision: number;
  poolEntries: Array<{ sessionId: string; live?: boolean; status: string }>;
  creatingSession?: boolean;
  viewingSessionId: string | null;
  activeSessionId: string | null;
  restoringSessionId: string | null;
  session?: { id: string; status: string };
};

/**
 * Minimal get/set harness for syncCatalogFromBridge.
 * @param catalog Starting catalog rows.
 * @param extra Fields that decide which ids survive a disk miss.
 */
function makeStore(
  catalog: SessionRecord[],
  extra?: Partial<Slice>,
): {
  set: (partial: Partial<Slice> | ((s: Slice) => Partial<Slice>)) => void;
  get: () => Slice;
  snap: () => Slice;
} {
  let state: Slice = {
    catalog,
    sessionRoles: {},
    sessionProvenance: {},
    pendingSessions: {},
    pendingSessionOrder: [],
    childSessions: {},
    catalogRevision: 0,
    poolEntries: [],
    viewingSessionId: null,
    activeSessionId: null,
    restoringSessionId: null,
    ...extra,
  };
  return {
    set: (partial) => {
      const patch = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...patch };
    },
    get: () => state,
    snap: () => state,
  };
}

/**
 * Local row with a real user line so prune keeps it when disk still lists it.
 * @param id Session id.
 * @param title Optional strong title.
 */
function localChat(id: string, title?: string): SessionRecord {
  const state = createSessionState({ id, workspace: "/w" });
  state.title = title ?? `Chat ${id}`;
  state.timeline = [
    { id: `${id}-u`, kind: "user", blocks: [{ type: "text", text: "hi" }] },
  ];
  return upsertFromLiveState([], state, 1)[0]!;
}

describe("syncCatalogFromBridge", () => {
  it("drops local rows when sessions_list succeeds with an empty directory", async () => {
    const store = makeStore([localChat("keep-me")]);
    const bridge = {
      cli: async () => ({ ok: true, data: { sessions: [] } }),
    } as unknown as LiveHandle;
    const result = await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(result.ok, true);
    assert.equal(result.count, 0);
    assert.equal(store.snap().catalog.length, 0);
  });

  it("drops a local row that disk no longer lists", async () => {
    const store = makeStore([
      localChat("keep-me", "Kept"),
      localChat("gone", "Deleted"),
    ]);
    const bridge = {
      cli: async () => ({
        ok: true,
        data: {
          sessions: [
            {
              id: "keep-me",
              title: "Kept",
              cwd: "/w",
              updatedAt: "2026-08-09T12:00:00.000Z",
            },
          ],
        },
      }),
    } as unknown as LiveHandle;
    const result = await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
    assert.ok(store.snap().catalog.some((row) => row.id === "keep-me"));
    assert.equal(
      store.snap().catalog.some((row) => row.id === "gone"),
      false,
    );
  });

  it("keeps a streaming canvas session that is not on disk yet", async () => {
    const store = makeStore([localChat("live-one"), localChat("stale")], {
      session: { id: "live-one", status: "streaming" },
      viewingSessionId: "live-one",
    });
    const bridge = {
      cli: async () => ({ ok: true, data: { sessions: [] } }),
    } as unknown as LiveHandle;
    await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    const ids = store.snap().catalog.map((row) => row.id);
    assert.deepEqual(ids, ["live-one"]);
    assert.equal(store.snap().viewingSessionId, "live-one");
  });

  it("clears the canvas when the open chat is gone from disk", async () => {
    const store = makeStore([localChat("gone")], {
      session: { id: "gone", status: "idle" },
      viewingSessionId: "gone",
      activeSessionId: "gone",
    });
    const bridge = {
      cli: async () => ({ ok: true, data: { sessions: [] } }),
    } as unknown as LiveHandle;
    await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(store.snap().viewingSessionId, null);
    assert.equal(store.snap().activeSessionId, null);
    assert.equal(store.snap().session?.id ?? "", "");
  });

  it("does not write the store when a second read matches the rail", async () => {
    const store = makeStore([]);
    const bridge = {
      cli: async () => ({
        ok: true,
        data: {
          sessions: [
            {
              id: "s1",
              title: "Hello",
              cwd: "/w",
              updatedAt: "2026-08-09T12:00:00.000Z",
            },
          ],
        },
      }),
    } as unknown as LiveHandle;
    await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    const revision = store.snap().catalogRevision;
    await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(store.snap().catalogRevision, revision);
    assert.equal(store.snap().catalog[0]?.title, "Hello");
  });

  it("does not repaint when only the timestamp moves inside the same label", async () => {
    const day = 24 * 60 * 60 * 1000;
    const older = new Date(Date.now() - 40 * day).toISOString();
    const newer = new Date(Date.now() - 50 * day).toISOString();
    const store = makeStore([]);
    const first = {
      cli: async () => ({
        ok: true,
        data: {
          sessions: [{ id: "s1", title: "Hello", cwd: "/w", updatedAt: older }],
        },
      }),
    } as unknown as LiveHandle;
    await syncCatalogFromBridge(first, store.set as never, store.get as never);
    const shown = store.snap().catalog;
    const revision = store.snap().catalogRevision;
    const second = {
      cli: async () => ({
        ok: true,
        data: {
          sessions: [{ id: "s1", title: "Hello", cwd: "/w", updatedAt: newer }],
        },
      }),
    } as unknown as LiveHandle;
    await syncCatalogFromBridge(second, store.set as never, store.get as never);
    assert.equal(store.snap().catalogRevision, revision);
    assert.equal(store.snap().catalog, shown);
  });

  it("returns a soft error when sessions_list fails", async () => {
    const store = makeStore([localChat("keep-me")]);
    const bridge = {
      cli: async () => ({ ok: false, error: "cli down" }),
    } as unknown as LiveHandle;
    const result = await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, "cli down");
    assert.ok(store.snap().catalog.some((row) => row.id === "keep-me"));
  });

  it("swallows thrown CLI errors without wiping catalog", async () => {
    const store = makeStore([localChat("keep-me")]);
    const bridge = {
      cli: async () => {
        throw new Error("socket closed");
      },
    } as unknown as LiveHandle;
    const result = await syncCatalogFromBridge(
      bridge,
      store.set as never,
      store.get as never,
    );
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /socket closed/);
    assert.ok(store.snap().catalog.some((row) => row.id === "keep-me"));
  });
});
