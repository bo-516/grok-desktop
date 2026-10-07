/**
 * The session rail is not cached in localStorage.
 * Startup deletes the legacy key. Persist calls do not write it back.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetCatalogPersistHooksForTests } from "@/store/catalogPersistQueue";
import {
  loadCatalogFromStorage,
  SESSION_STORAGE_KEY,
  type SessionRecord,
} from "@/store/sessionCatalog";
import {
  persistCatalog,
  persistNormalizedCatalog,
} from "@/store/sessionStoreSupport";

/** In-memory localStorage stub. */
function installLocalStorage(): {
  setItemCalls: number;
  mem: Map<string, string>;
} {
  const mem = new Map<string, string>();
  const state = { setItemCalls: 0, mem };
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      state.setItemCalls += 1;
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return state;
}

function sampleRecord(id: string): SessionRecord {
  return {
    id,
    workspace: "/w",
    title: `Chat ${id}`,
    mode: "build",
    model: "m",
    status: "idle",
    createdAt: 1,
    updatedAt: 2,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

describe("catalog is not cached", () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage();
    resetCatalogPersistHooksForTests();
  });

  afterEach(() => {
    resetCatalogPersistHooksForTests();
  });

  it("loadCatalogFromStorage deletes the legacy key and returns empty", () => {
    storage.mem.set(SESSION_STORAGE_KEY, JSON.stringify([sampleRecord("old")]));
    const loaded = loadCatalogFromStorage();
    assert.deepEqual(loaded, []);
    assert.equal(storage.mem.has(SESSION_STORAGE_KEY), false);
    assert.equal(storage.setItemCalls, 0);
  });

  it("persist calls do not write localStorage", () => {
    persistNormalizedCatalog([sampleRecord("a")]);
    persistCatalog([sampleRecord("b")]);
    assert.equal(storage.setItemCalls, 0);
    assert.equal(storage.mem.has(SESSION_STORAGE_KEY), false);
  });
});
