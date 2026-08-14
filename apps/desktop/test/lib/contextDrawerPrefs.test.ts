/**
 * Context-drawer layout prefs: normalize, clamp, load/save.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CONTEXT_DRAWER_PREFS_KEY,
  loadContextDrawerPrefs,
  normalizeContextDrawerPrefs,
  saveContextDrawerPrefs,
} from "@/lib/contextDrawerPrefs";

/** In-memory localStorage stub for load/save tests. */
function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

/** Install a Storage stub on globalThis.localStorage for one test. */
function installLocalStorage(storage: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

/** Remove the stub so other suites do not see a fake localStorage. */
function clearLocalStorageStub(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

afterEach(() => {
  clearLocalStorageStub();
});

describe("contextDrawerPrefs", () => {
  it("normalizeContextDrawerPrefs defaults corrupt / empty input to push", () => {
    assert.deepEqual(normalizeContextDrawerPrefs(undefined), {
      layout: "push",
    });
    assert.deepEqual(normalizeContextDrawerPrefs(null), { layout: "push" });
    assert.deepEqual(normalizeContextDrawerPrefs({}), { layout: "push" });
    assert.deepEqual(normalizeContextDrawerPrefs({ layout: "nonsense" }), {
      layout: "push",
    });
    assert.deepEqual(normalizeContextDrawerPrefs("push"), { layout: "push" });
    assert.deepEqual(normalizeContextDrawerPrefs(42), { layout: "push" });
  });

  it("normalizeContextDrawerPrefs round-trips overlay", () => {
    assert.deepEqual(normalizeContextDrawerPrefs({ layout: "overlay" }), {
      layout: "overlay",
    });
  });

  it("loadContextDrawerPrefs reads storage and falls back on junk", () => {
    installLocalStorage(
      createMemoryStorage({
        [CONTEXT_DRAWER_PREFS_KEY]: JSON.stringify({ layout: "overlay" }),
      }),
    );
    assert.deepEqual(loadContextDrawerPrefs(), { layout: "overlay" });

    installLocalStorage(
      createMemoryStorage({
        [CONTEXT_DRAWER_PREFS_KEY]: "not-json{",
      }),
    );
    assert.deepEqual(loadContextDrawerPrefs(), { layout: "push" });

    installLocalStorage(createMemoryStorage());
    assert.deepEqual(loadContextDrawerPrefs(), { layout: "push" });
  });

  it("saveContextDrawerPrefs writes normalized blob; swallows setItem errors", () => {
    const storage = createMemoryStorage();
    installLocalStorage(storage);
    saveContextDrawerPrefs({ layout: "overlay" });
    assert.equal(
      storage.getItem(CONTEXT_DRAWER_PREFS_KEY),
      JSON.stringify({ layout: "overlay" }),
    );

    const throwing: Storage = {
      ...createMemoryStorage(),
      setItem() {
        throw new Error("quota");
      },
    };
    installLocalStorage(throwing);
    // Must not throw — private mode / quota.
    saveContextDrawerPrefs({ layout: "push" });
  });

  it("narrow-window overlay does not rewrite a stored push preference", () => {
    const storage = createMemoryStorage();
    installLocalStorage(storage);
    saveContextDrawerPrefs({ layout: "push" });
    // resolveShellLayout may return overlay; storage must stay push.
    assert.deepEqual(loadContextDrawerPrefs(), { layout: "push" });
  });
});
