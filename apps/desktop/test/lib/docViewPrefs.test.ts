/**
 * Unit tests for document preview prefs normalize / load / save / defaults.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  DEFAULT_DOC_PREFS,
  DOC_VIEW_PREFS_KEY,
  loadDocViewPrefs,
  normalizeDocViewPrefs,
  patchDocViewPrefs,
  saveDocViewPrefs,
} from "@/lib/docViewPrefs";

describe("docViewPrefs", () => {
  it("DEFAULT_DOC_PREFS.mode is rendered", () => {
    assert.equal(DEFAULT_DOC_PREFS.mode, "rendered");
  });

  it("normalize falls back to defaults on garbage", () => {
    assert.deepEqual(normalizeDocViewPrefs(null), { mode: "rendered" });
    assert.deepEqual(normalizeDocViewPrefs("x"), { mode: "rendered" });
    assert.deepEqual(normalizeDocViewPrefs(42), { mode: "rendered" });
    assert.deepEqual(normalizeDocViewPrefs({ mode: "nope" }), {
      mode: "rendered",
    });
    assert.deepEqual(normalizeDocViewPrefs({}), { mode: "rendered" });
  });

  it("normalize accepts rendered and source", () => {
    assert.deepEqual(normalizeDocViewPrefs({ mode: "rendered" }), {
      mode: "rendered",
    });
    assert.deepEqual(normalizeDocViewPrefs({ mode: "source" }), {
      mode: "source",
    });
  });

  it("patchDocViewPrefs merges mode", () => {
    const next = patchDocViewPrefs({ mode: "rendered" }, { mode: "source" });
    assert.deepEqual(next, { mode: "source" });
  });

  describe("localStorage round-trip", () => {
    /** In-memory store backing a fake localStorage for this suite. */
    const store = new Map<string, string>();
    const fakeStorage: Storage = {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.has(key) ? (store.get(key) as string) : null;
      },
      key(index: number) {
        return [...store.keys()][index] ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, String(value));
      },
    };

    /** Previous global localStorage descriptor, restored after each test. */
    let previous: PropertyDescriptor | undefined;

    beforeEach(() => {
      store.clear();
      previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        enumerable: true,
        value: fakeStorage,
        writable: true,
      });
    });

    afterEach(() => {
      if (previous) {
        Object.defineProperty(globalThis, "localStorage", previous);
      } else {
        // Node has no localStorage by default — remove our stub.
        Reflect.deleteProperty(globalThis, "localStorage");
      }
    });

    it("save then load round-trips mode", () => {
      saveDocViewPrefs({ mode: "source" });
      assert.equal(store.get(DOC_VIEW_PREFS_KEY), '{"mode":"source"}');
      assert.deepEqual(loadDocViewPrefs(), { mode: "source" });
    });

    it("load recovers from bad JSON", () => {
      store.set(DOC_VIEW_PREFS_KEY, "{not-json");
      assert.deepEqual(loadDocViewPrefs(), { mode: "rendered" });
    });

    it("load recovers from bad mode values", () => {
      store.set(DOC_VIEW_PREFS_KEY, JSON.stringify({ mode: "html" }));
      assert.deepEqual(loadDocViewPrefs(), { mode: "rendered" });
    });
  });

  it("load without localStorage returns default and does not throw", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    // Ensure the typeof localStorage === "undefined" branch is hit.
    Reflect.deleteProperty(globalThis, "localStorage");
    try {
      assert.deepEqual(loadDocViewPrefs(), { mode: "rendered" });
      // save is a no-op when storage is missing.
      saveDocViewPrefs({ mode: "source" });
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, "localStorage", previous);
      }
    }
  });
});
