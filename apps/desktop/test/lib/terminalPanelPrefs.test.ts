/**
 * Terminal dock prefs: normalize, clamp, guarded load/save.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  clampTerminalPanelHeight,
  loadTerminalPanelPrefs,
  normalizeTerminalPanelPrefs,
  saveTerminalPanelPrefs,
  TERMINAL_PANEL_HEIGHT_DEFAULT,
  TERMINAL_PANEL_HEIGHT_MIN,
  TERMINAL_PANEL_PREFS_KEY,
} from "@/lib/terminalPanelPrefs";

/** Install (or remove with undefined) a localStorage stub on globalThis. */
function installStorage(storage: Partial<Storage> | undefined): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

/** Map-backed Storage stub. */
function memoryStorage(initial: Record<string, string> = {}): Partial<Storage> {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
}

afterEach(() => installStorage(undefined));

describe("terminalPanelPrefs", () => {
  it("normalizes junk field by field", () => {
    assert.deepEqual(normalizeTerminalPanelPrefs(null), {
      open: false,
      height: TERMINAL_PANEL_HEIGHT_DEFAULT,
    });
    assert.deepEqual(normalizeTerminalPanelPrefs({ open: "yes", height: 10 }), {
      open: false,
      height: TERMINAL_PANEL_HEIGHT_MIN,
    });
    assert.deepEqual(normalizeTerminalPanelPrefs({ open: true, height: 333.6 }), {
      open: true,
      height: 334,
    });
  });

  it("clamps height to the minimum and the viewport share", () => {
    assert.equal(clampTerminalPanelHeight(50, 1000), TERMINAL_PANEL_HEIGHT_MIN);
    assert.equal(clampTerminalPanelHeight(900, 1000), 750);
    assert.equal(clampTerminalPanelHeight(900, 0), 900);
    assert.equal(clampTerminalPanelHeight(Number.NaN, 1000), TERMINAL_PANEL_HEIGHT_DEFAULT);
    assert.equal(clampTerminalPanelHeight(300, 100), TERMINAL_PANEL_HEIGHT_MIN);
  });

  it("round-trips through localStorage and survives corrupt / throwing storage", () => {
    installStorage(memoryStorage());
    saveTerminalPanelPrefs({ open: true, height: 300 });
    assert.deepEqual(loadTerminalPanelPrefs(), { open: true, height: 300 });

    installStorage(memoryStorage({ [TERMINAL_PANEL_PREFS_KEY]: "{not json" }));
    assert.equal(loadTerminalPanelPrefs().open, false);

    installStorage({
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    assert.equal(loadTerminalPanelPrefs().height, TERMINAL_PANEL_HEIGHT_DEFAULT);
    assert.doesNotThrow(() => saveTerminalPanelPrefs({ open: true, height: 200 }));
  });
});
