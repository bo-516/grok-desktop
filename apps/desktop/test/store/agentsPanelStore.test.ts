/**
 * Agents panel focus / cycle / owner-reset / width persist.
 * Drives the shipped store and pure helpers.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  AGENTS_WIDTH_DEFAULT,
  AGENTS_WIDTH_MAX,
  AGENTS_WIDTH_MIN,
  AGENTS_WIDTH_STORAGE_KEY,
  agentsEscapeAction,
  clampAgentsWidth,
  cycleAgentsFocus,
  effectiveAgentsFocus,
  loadAgentsWidth,
  nextAgentsDrawerEscape,
  resetAgentsPanelStoreForTests,
  saveAgentsWidth,
  useAgentsPanelStore,
} from "@/store/agentsPanelStore";

/** In-memory localStorage for persist tests (Node has none by default). */
class MemoryStorage {
  /** Backing map. */
  private readonly data = new Map<string, string>();
  /**
   * @param key Storage key.
   * @returns Stored value or null.
   */
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) ?? null) : null;
  }
  /**
   * @param key Storage key.
   * @param value String value to store.
   */
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  /**
   * @param key Storage key to drop.
   */
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const memory = new MemoryStorage();

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage =
    memory;
  memory.removeItem(AGENTS_WIDTH_STORAGE_KEY);
  resetAgentsPanelStoreForTests();
});

afterEach(() => {
  resetAgentsPanelStoreForTests();
});

describe("cycleAgentsFocus", () => {
  const ids = ["a", "b", "c"];

  it("cycle(+1) from last id lands on roster (no wrap)", () => {
    const next = cycleAgentsFocus(
      { kind: "subagent", childSessionId: "c" },
      1,
      ids,
    );
    assert.deepEqual(next, { kind: "roster" });
  });

  it("cycle(-1) from first id lands on roster", () => {
    const next = cycleAgentsFocus(
      { kind: "subagent", childSessionId: "a" },
      -1,
      ids,
    );
    assert.deepEqual(next, { kind: "roster" });
  });

  it("cycle(+1) from roster focuses the first id", () => {
    const next = cycleAgentsFocus({ kind: "roster" }, 1, ids);
    assert.deepEqual(next, { kind: "subagent", childSessionId: "a" });
  });

  it("cycle(-1) from roster stays roster", () => {
    const next = cycleAgentsFocus({ kind: "roster" }, -1, ids);
    assert.deepEqual(next, { kind: "roster" });
  });
});

describe("useAgentsPanelStore cycle / reset / owner", () => {
  it("store cycle(+1) at last id → roster", () => {
    const store = useAgentsPanelStore.getState();
    store.focusSubagent("c", "parent");
    store.cycle(1, ["a", "b", "c"]);
    assert.deepEqual(useAgentsPanelStore.getState().focus, { kind: "roster" });
  });

  it("focusSubagent then resetForSession returns roster", () => {
    useAgentsPanelStore.getState().focusSubagent("child-1", "parent-1");
    assert.equal(useAgentsPanelStore.getState().focus.kind, "subagent");
    useAgentsPanelStore.getState().resetForSession("parent-2");
    const next = useAgentsPanelStore.getState();
    assert.deepEqual(next.focus, { kind: "roster" });
    assert.equal(next.ownerSessionId, "parent-2");
  });

  it("mismatched owner reads as roster", () => {
    useAgentsPanelStore.getState().focusSubagent("child-1", "parent-1");
    const raw = useAgentsPanelStore.getState().focus;
    const owner = useAgentsPanelStore.getState().ownerSessionId;
    const effective = effectiveAgentsFocus(raw, owner, "other-parent");
    assert.deepEqual(effective, { kind: "roster" });
    const matched = effectiveAgentsFocus(raw, owner, "parent-1");
    assert.equal(matched.kind, "subagent");
  });
});

describe("agents width clamp + persist", () => {
  it("clamps below min, above max, and non-finite", () => {
    assert.equal(clampAgentsWidth(100), AGENTS_WIDTH_MIN);
    assert.equal(clampAgentsWidth(900), AGENTS_WIDTH_MAX);
    assert.equal(clampAgentsWidth(Number.NaN), AGENTS_WIDTH_DEFAULT);
    assert.equal(clampAgentsWidth(300), 300);
  });

  it("setWidth persists and loadAgentsWidth reads grok-desktop.agents-width.v3", () => {
    useAgentsPanelStore.getState().setWidth(360);
    assert.equal(useAgentsPanelStore.getState().width, 360);
    assert.equal(memory.getItem(AGENTS_WIDTH_STORAGE_KEY), "360");
    assert.equal(loadAgentsWidth(), 360);
    saveAgentsWidth(200);
    assert.equal(memory.getItem(AGENTS_WIDTH_STORAGE_KEY), String(AGENTS_WIDTH_MIN));
  });
});

describe("two-level Escape", () => {
  it("detail → roster; roster → close", () => {
    assert.equal(
      agentsEscapeAction({ kind: "subagent", childSessionId: "c" }),
      "roster",
    );
    assert.equal(agentsEscapeAction({ kind: "roster" }), "close");
    assert.equal(
      nextAgentsDrawerEscape({
        open: true,
        rail: "agents",
        effectiveFocus: { kind: "subagent", childSessionId: "c" },
      }),
      "roster",
    );
    assert.equal(
      nextAgentsDrawerEscape({
        open: true,
        rail: "agents",
        effectiveFocus: { kind: "roster" },
      }),
      "close",
    );
    assert.equal(
      nextAgentsDrawerEscape({
        open: false,
        rail: "agents",
        effectiveFocus: { kind: "roster" },
      }),
      "ignore",
    );
  });
});
