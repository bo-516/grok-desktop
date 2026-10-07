/**
 * Unit tests for crashLog pure helpers (persist ring + path defaults).
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  CRASH_LOG_STORAGE_KEY,
  persistCrashLocally,
  readCrashLog,
  thrownMessage,
  uiLogPath,
} from "../../src/lib/crashLog.js";

describe("crashLog", () => {
  const mem = new Map<string, string>();

  beforeEach(() => {
    mem.clear();
    // Minimal localStorage stub for node:test (no jsdom).
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
    });
  });

  afterEach(() => {
    mem.clear();
  });

  it("persistCrashLocally keeps a ring of entries", () => {
    for (let i = 0; i < 25; i++) {
      persistCrashLocally({
        at: i,
        level: "error",
        message: `m${i}`,
      });
    }
    const list = readCrashLog();
    assert.equal(list.length, 20);
    assert.equal(list[0]?.message, "m5");
    assert.equal(list[19]?.message, "m24");
    assert.ok(mem.get(CRASH_LOG_STORAGE_KEY));
  });

  it("thrownMessage prefers Error.message, then strings, then fallback", () => {
    assert.equal(thrownMessage(new Error("boom"), "fb"), "boom");
    assert.equal(thrownMessage(new Error(""), "fb"), "");
    assert.equal(thrownMessage("plain", "fb"), "plain");
    assert.equal(thrownMessage({ message: "x" }, "fb"), "fb");
    assert.equal(thrownMessage(undefined, "fb"), "fb");
  });

  it("uiLogPath is empty without window (no POST in node tests)", () => {
    // Browser path defaults to /__grok_desktop_log; node has no window.
    const p = uiLogPath();
    assert.equal(p, "");
  });
});
