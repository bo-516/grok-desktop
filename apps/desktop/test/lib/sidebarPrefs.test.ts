/**
 * Left-rail visibility prefs: normalize, load/save, dock + click actions.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isSidebarDocked,
  loadSidebarPrefs,
  normalizeSidebarPrefs,
  saveSidebarPrefs,
  sidebarCollapseAction,
  sidebarToggleAction,
  SIDEBAR_PREFS_KEY,
} from "@/lib/sidebarPrefs";

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

describe("sidebarPrefs", () => {
  it("normalizeSidebarPrefs defaults corrupt / empty input to not-collapsed", () => {
    assert.deepEqual(normalizeSidebarPrefs(undefined), { collapsed: false });
    assert.deepEqual(normalizeSidebarPrefs(null), { collapsed: false });
    assert.deepEqual(normalizeSidebarPrefs({}), { collapsed: false });
    assert.deepEqual(normalizeSidebarPrefs({ collapsed: "yes" }), {
      collapsed: false,
    });
    assert.deepEqual(normalizeSidebarPrefs("collapsed"), { collapsed: false });
    assert.deepEqual(normalizeSidebarPrefs(42), { collapsed: false });
  });

  it("normalizeSidebarPrefs only treats boolean true as collapsed", () => {
    assert.deepEqual(normalizeSidebarPrefs({ collapsed: true }), {
      collapsed: true,
    });
    assert.deepEqual(normalizeSidebarPrefs({ collapsed: false }), {
      collapsed: false,
    });
  });

  it("loadSidebarPrefs reads storage and falls back on junk", () => {
    installLocalStorage(
      createMemoryStorage({
        [SIDEBAR_PREFS_KEY]: JSON.stringify({ collapsed: true }),
      }),
    );
    assert.deepEqual(loadSidebarPrefs(), { collapsed: true });

    installLocalStorage(
      createMemoryStorage({
        [SIDEBAR_PREFS_KEY]: "not-json{",
      }),
    );
    assert.deepEqual(loadSidebarPrefs(), { collapsed: false });

    installLocalStorage(createMemoryStorage());
    assert.deepEqual(loadSidebarPrefs(), { collapsed: false });
  });

  it("saveSidebarPrefs writes normalized blob; swallows setItem errors", () => {
    const storage = createMemoryStorage();
    installLocalStorage(storage);
    saveSidebarPrefs({ collapsed: true });
    assert.equal(
      storage.getItem(SIDEBAR_PREFS_KEY),
      JSON.stringify({ collapsed: true }),
    );

    const throwing: Storage = {
      ...createMemoryStorage(),
      setItem() {
        throw new Error("quota");
      },
    };
    installLocalStorage(throwing);
    saveSidebarPrefs({ collapsed: false });
  });

  it("isSidebarDocked requires both viewport room and a visible pref", () => {
    assert.equal(isSidebarDocked(true, false), true);
    assert.equal(isSidebarDocked(true, true), false);
    assert.equal(isSidebarDocked(false, false), false);
    assert.equal(isSidebarDocked(false, true), false);
  });

  it("sidebarCollapseAction persists only when the rail is occupying space", () => {
    assert.equal(
      sidebarCollapseAction({ layoutCanDock: true, userCollapsed: false }),
      "persist-collapse",
    );
    assert.equal(
      sidebarCollapseAction({ layoutCanDock: true, userCollapsed: true }),
      "close-overlay",
    );
    assert.equal(
      sidebarCollapseAction({ layoutCanDock: false, userCollapsed: false }),
      "close-overlay",
    );
  });

  it("sidebarToggleAction re-docks a user-hidden rail that still fits", () => {
    assert.equal(
      sidebarToggleAction({ layoutCanDock: true, userCollapsed: true }),
      "re-dock",
    );
    assert.equal(
      sidebarToggleAction({ layoutCanDock: false, userCollapsed: true }),
      "toggle-overlay",
    );
    assert.equal(
      sidebarToggleAction({ layoutCanDock: true, userCollapsed: false }),
      "toggle-overlay",
    );
  });
});
