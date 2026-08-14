/**
 * sessions_list sync: empty remote must not wipe local rows; CLI failure is
 * a soft error so a flaky inspect does not clear the rail.
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
};

/**
 * Minimal get/set harness for syncCatalogFromBridge.
 * @param catalog Starting catalog rows.
 */
function makeStore(catalog: SessionRecord[]): {
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
 * Local row with a real user line so prune keeps it.
 * @param id Session id.
 */
function localChat(id: string): SessionRecord {
  const state = createSessionState({ id, workspace: "/w" });
  state.title = `Chat ${id}`;
  state.timeline = [
    { id: `${id}-u`, kind: "user", blocks: [{ type: "text", text: "hi" }] },
  ];
  return upsertFromLiveState([], state, 1)[0]!;
}

describe("syncCatalogFromBridge", () => {
  it("keeps local catalog rows when sessions_list is empty", async () => {
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
    assert.ok(store.snap().catalog.some((row) => row.id === "keep-me"));
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
