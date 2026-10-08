/**
 * Update-check localStorage: corrupt blobs, dismiss, and the enable toggle.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readAppVersion, DEV_APP_VERSION } from "@/lib/appVersion";
import {
  dismissUpdateVersion,
  loadUpdateCheckPrefs,
  parseStoredUpdateCheck,
  saveUpdateCheckPrefs,
  setUpdateCheckEnabled,
  UPDATE_CHECK_STORAGE_KEY,
} from "@/lib/updateCheckStorage";
import { defaultUpdateCheckPrefs } from "@/lib/updateCheck";

/** In-memory Storage stand-in. Only the methods the module calls. */
type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

/** How many change events the stub window saw. Reset per test. */
let changeEvents = 0;

/**
 * Install a memory localStorage and a window that counts change events.
 * Restored by afterEach so other files in the same process are not affected
 * when the runner does not isolate files.
 */
function installMemoryStorage(): MemoryStorage {
  const mem = new Map<string, string>();
  const storage: MemoryStorage = {
    getItem: (key) => {
      const value = mem.get(key);
      return value === undefined ? null : value;
    },
    setItem: (key, value) => {
      mem.set(key, value);
    },
    removeItem: (key) => {
      mem.delete(key);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: () => {
        changeEvents += 1;
        return true;
      },
    },
  });
  changeEvents = 0;
  return storage;
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
  changeEvents = 0;
});

describe("parseStoredUpdateCheck", () => {
  it("defaults to checks enabled when the key is missing or junk", () => {
    assert.deepEqual(parseStoredUpdateCheck(null), defaultUpdateCheckPrefs());
    assert.deepEqual(parseStoredUpdateCheck("{"), defaultUpdateCheckPrefs());
    assert.deepEqual(parseStoredUpdateCheck("[]"), defaultUpdateCheckPrefs());
  });

  it("drops a cached release whose URL is not on the GitHub allow-list", () => {
    const raw = JSON.stringify({
      enabled: true,
      dismissedVersion: "v0.3.0",
      lastCheckedAt: 10,
      cached: {
        version: "v0.4.0",
        notesUrl: "https://evil.example/notes",
        downloadUrl: "https://github.com/bo-516/grok-desktop/releases/latest",
      },
    });
    const prefs = parseStoredUpdateCheck(raw);
    assert.equal(prefs.enabled, true);
    assert.equal(prefs.dismissedVersion, "0.3.0");
    assert.equal(prefs.lastCheckedAt, 10);
    assert.equal(prefs.cached, null);
  });

  it("keeps an explicit disable and a safe cache", () => {
    const raw = JSON.stringify({
      enabled: false,
      dismissedVersion: "nope",
      lastCheckedAt: Number.POSITIVE_INFINITY,
      cached: {
        version: "0.3.0",
        notesUrl: "https://github.com/bo-516/grok-desktop/releases/tag/v0.3.0",
        downloadUrl:
          "https://github.com/bo-516/grok-desktop/releases/latest/download/Grok-Desktop-macos-universal.zip",
      },
    });
    const prefs = parseStoredUpdateCheck(raw);
    assert.equal(prefs.enabled, false);
    assert.equal(prefs.dismissedVersion, null);
    assert.equal(prefs.lastCheckedAt, null);
    assert.equal(prefs.cached?.version, "0.3.0");
  });
});

describe("update check storage writes", () => {
  it("round-trips prefs and announces the change", () => {
    installMemoryStorage();
    saveUpdateCheckPrefs({
      ...defaultUpdateCheckPrefs(),
      enabled: false,
      dismissedVersion: "0.3.0",
      lastCheckedAt: 42,
    });
    const loaded = loadUpdateCheckPrefs();
    assert.equal(loaded.enabled, false);
    assert.equal(loaded.dismissedVersion, "0.3.0");
    assert.equal(loaded.lastCheckedAt, 42);
    assert.equal(changeEvents, 1);
    const raw = localStorage.getItem(UPDATE_CHECK_STORAGE_KEY);
    assert.equal(typeof raw, "string");
  });

  it("disables checks without clearing a dismissed version", () => {
    installMemoryStorage();
    dismissUpdateVersion("v0.8.0");
    setUpdateCheckEnabled(false);
    const loaded = loadUpdateCheckPrefs();
    assert.equal(loaded.enabled, false);
    assert.equal(loaded.dismissedVersion, "0.8.0");
    assert.equal(changeEvents, 2);
  });

  it("ignores a dismiss that is not semver", () => {
    installMemoryStorage();
    dismissUpdateVersion("nightly");
    assert.equal(loadUpdateCheckPrefs().dismissedVersion, null);
    assert.equal(changeEvents, 0);
  });
});

describe("readAppVersion", () => {
  it("falls back when the Vite define is absent", () => {
    assert.equal(readAppVersion(), DEV_APP_VERSION);
  });
});
