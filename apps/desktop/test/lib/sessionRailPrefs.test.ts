/**
 * Session rail pin / collapse / drag-order prefs helpers.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  collapseWorkspacePreview,
  expandWorkspacePreview,
} from "@/lib/sessionRailPreview";
import {
  applyWorkspaceSessionOrder,
  isPreviewExpanded,
  isSessionPinned,
  isWorkspaceCollapsed,
  loadSessionRailPrefs,
  moveSessionIdInOrder,
  normalizeSessionRailPrefs,
  normalizeWorkspaceKey,
  orderGroupsBySessionPin,
  orderSessionsByPin,
  orderSessionsByRecency,
  orderSessionsByUserThenRecency,
  resetSessionRailPrefsCache,
  saveSessionRailPrefs,
  SESSION_RAIL_PREFS_KEY,
  toggleCollapsedWorkspace,
  togglePinnedSession,
  workspaceParentPath,
} from "@/lib/sessionRailPrefs";
import type { ProjectGroup, SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal catalog row for ordering tests.
 * @param id Session id (also used as title when title omitted).
 * @param updatedAt Last message activity ms (drives recency auto-sort).
 * @param title Optional display title (not used for default rail order).
 */
function rec(id: string, updatedAt: number, title?: string): SessionRecord {
  return {
    id,
    workspace: "/ws",
    title: title ?? id,
    mode: "build",
    model: "",
    status: "idle",
    createdAt: updatedAt,
    updatedAt,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
  };
}

/**
 * Empty project group for group-order tests.
 * @param workspace Absolute path key.
 * @param projectName Display name.
 * @param sessions Optional sessions (default empty).
 */
function group(
  workspace: string,
  projectName: string,
  sessions: SessionRecord[] = [],
): ProjectGroup {
  return {
    workspace,
    projectName,
    sessions,
  };
}

/**
 * Install a Map-backed localStorage for Node tests (Node's stub lacks methods).
 * @returns Restore function that reverts globalThis.localStorage.
 */
function installMemoryLocalStorage(): () => void {
  const map = new Map<string, string>();
  const prev = (globalThis as { localStorage?: Storage }).localStorage;
  const mock: Storage = {
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
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: mock,
  });
  return () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: prev,
    });
  };
}

describe("sessionRailPrefs", () => {
  /** Tear down memory localStorage when a storage test installed one. */
  let restoreLocalStorage: (() => void) | null = null;

  beforeEach(() => {
    resetSessionRailPrefsCache();
  });

  afterEach(() => {
    resetSessionRailPrefsCache();
    restoreLocalStorage?.();
    restoreLocalStorage = null;
  });

  it("normalizeSessionRailPrefs dedupes session pins and drops junk", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedSessions: ["a", "a", 1, "", "b"],
      collapsedWorkspaces: ["/b", "/b", null],
    });
    assert.deepEqual(prefs.pinnedSessions, ["a", "b"]);
    assert.deepEqual(prefs.collapsedWorkspaces, ["/b"]);
    assert.deepEqual(prefs.previewExpandedWorkspaces, []);
  });

  it("normalizeWorkspaceKey strips trailing slashes", () => {
    assert.equal(normalizeWorkspaceKey("/ws/project/"), "/ws/project");
    assert.equal(normalizeWorkspaceKey("(no project)"), "(no project)");
  });

  it("ignores legacy pinnedWorkspaces without inventing session pins", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedWorkspaces: ["/old-folder"],
      collapsedWorkspaces: [],
    });
    assert.deepEqual(prefs.pinnedSessions, []);
  });

  it("togglePinnedSession inserts new pins at front and unpins", () => {
    let prefs = normalizeSessionRailPrefs({
      pinnedSessions: ["old"],
      collapsedWorkspaces: [],
    });
    prefs = togglePinnedSession(prefs, "new");
    assert.deepEqual(prefs.pinnedSessions, ["new", "old"]);
    assert.equal(isSessionPinned(prefs, "new"), true);
    prefs = togglePinnedSession(prefs, "new");
    assert.deepEqual(prefs.pinnedSessions, ["old"]);
    assert.equal(isSessionPinned(prefs, "new"), false);
  });

  it("toggleCollapsedWorkspace flips membership and normalizes path keys", () => {
    let prefs = normalizeSessionRailPrefs({});
    prefs = toggleCollapsedWorkspace(prefs, "/ws/");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), true);
    assert.equal(isWorkspaceCollapsed(prefs, "/ws/"), true);
    assert.deepEqual(prefs.collapsedWorkspaces, ["/ws"]);
    prefs = toggleCollapsedWorkspace(prefs, "/ws");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), false);
  });

  it("collapse clears preview-expand for that workspace", () => {
    let prefs = normalizeSessionRailPrefs({
      previewExpandedWorkspaces: ["/ws", "/other"],
    });
    prefs = toggleCollapsedWorkspace(prefs, "/ws");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), true);
    assert.equal(isPreviewExpanded(prefs, "/ws"), false);
    assert.equal(isPreviewExpanded(prefs, "/other"), true);
  });

  it("expandWorkspacePreview sticks until collapse", () => {
    let prefs = normalizeSessionRailPrefs({});
    prefs = expandWorkspacePreview(prefs, "/ws");
    assert.equal(isPreviewExpanded(prefs, "/ws"), true);
    prefs = expandWorkspacePreview(prefs, "/ws");
    assert.deepEqual(prefs.previewExpandedWorkspaces, ["/ws"]);
  });

  it("collapseWorkspacePreview restores preview without collapsing the folder", () => {
    let prefs = normalizeSessionRailPrefs({
      previewExpandedWorkspaces: ["/ws", "/other"],
    });
    prefs = collapseWorkspacePreview(prefs, "/ws/");
    assert.equal(isPreviewExpanded(prefs, "/ws"), false);
    assert.equal(isPreviewExpanded(prefs, "/other"), true);
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), false);
    const same = collapseWorkspacePreview(prefs, "/ws");
    assert.equal(same, prefs);
  });

  it("save/load roundtrip keeps collapsed workspaces across remount", () => {
    restoreLocalStorage = installMemoryLocalStorage();
    let prefs = normalizeSessionRailPrefs({});
    prefs = toggleCollapsedWorkspace(prefs, "/Users/me/code/proj");
    saveSessionRailPrefs(prefs);
    resetSessionRailPrefsCache();
    const reloaded = loadSessionRailPrefs();
    assert.equal(isWorkspaceCollapsed(reloaded, "/Users/me/code/proj"), true);
    assert.deepEqual(reloaded.collapsedWorkspaces, ["/Users/me/code/proj"]);
    assert.ok(localStorage.getItem(SESSION_RAIL_PREFS_KEY));
  });

  it("memory cache survives without re-reading empty storage mid-session", () => {
    restoreLocalStorage = installMemoryLocalStorage();
    let prefs = normalizeSessionRailPrefs({});
    prefs = toggleCollapsedWorkspace(prefs, "/a");
    saveSessionRailPrefs(prefs);
    // Simulate a wiped storage write after cache is warm.
    localStorage.removeItem(SESSION_RAIL_PREFS_KEY);
    const fromCache = loadSessionRailPrefs();
    assert.equal(isWorkspaceCollapsed(fromCache, "/a"), true);
  });

  it("orderSessionsByRecency sorts by updatedAt desc then id", () => {
    const sessions = [
      rec("z", 1, "zeta"),
      rec("a", 9, "alpha"),
      rec("m", 5, "mu"),
    ];
    const ordered = orderSessionsByRecency(sessions);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["a", "m", "z"],
    );
  });

  it("orderSessionsByUserThenRecency prefers drag order over recency", () => {
    const sessions = [
      rec("a", 1, "alpha"),
      rec("b", 2, "beta"),
      rec("c", 3, "gamma"),
    ];
    const ordered = orderSessionsByUserThenRecency(sessions, ["c", "a"]);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["c", "a", "b"],
    );
  });

  it("orderSessionsByUserThenRecency appends unlisted sessions by recency", () => {
    const sessions = [
      rec("old", 10),
      rec("mid", 20),
      rec("new", 30),
    ];
    // Only "old" is in drag order; mid/new append by updatedAt desc.
    const ordered = orderSessionsByUserThenRecency(sessions, ["old"]);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["old", "new", "mid"],
    );
  });

  it("orderSessionsByPin puts pinned ids first; drag then recency for rest", () => {
    const sessions = [
      rec("c", 3, "c"),
      rec("b", 2, "b"),
      rec("a", 1, "a"),
      rec("d", 4, "d"),
    ];
    const ordered = orderSessionsByPin(sessions, ["a", "c"], ["d", "b"]);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["a", "c", "d", "b"],
    );
  });

  it("orderGroupsBySessionPin keeps folder order; pin only reorders sessions inside", () => {
    const groups = [
      group("/c", "c", [rec("c1", 30), rec("c2", 31)]),
      group("/b", "b", [rec("b1", 20)]),
      group("/a", "a", [rec("a1", 10), rec("a2", 11)]),
    ];
    // Pin a1 and c2: folders stay /c → /b → /a; only in-group order changes.
    const ordered = orderGroupsBySessionPin(groups, ["a1", "c2"]);
    assert.deepEqual(
      ordered.map((g) => g.workspace),
      ["/c", "/b", "/a"],
    );
    assert.deepEqual(
      ordered[0]?.sessions.map((s) => s.id),
      ["c2", "c1"],
    );
    assert.deepEqual(
      ordered[2]?.sessions.map((s) => s.id),
      ["a1", "a2"],
    );
  });

  it("orderGroupsBySessionPin applies per-workspace drag order", () => {
    const groups = [
      group("/ws", "ws", [
        rec("a", 1, "a"),
        rec("b", 2, "b"),
        rec("c", 3, "c"),
      ]),
    ];
    const ordered = orderGroupsBySessionPin(groups, [], {
      "/ws": ["c", "a", "b"],
    });
    assert.deepEqual(
      ordered[0]?.sessions.map((s) => s.id),
      ["c", "a", "b"],
    );
  });

  it("moveSessionIdInOrder moves fromId to toId index", () => {
    assert.deepEqual(moveSessionIdInOrder(["a", "b", "c", "d"], "d", "b"), [
      "a",
      "d",
      "b",
      "c",
    ]);
    assert.deepEqual(moveSessionIdInOrder(["a", "b"], "a", "a"), ["a", "b"]);
  });

  it("applyWorkspaceSessionOrder stores drag order and realigns pins", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedSessions: ["b", "a"],
      collapsedWorkspaces: [],
      previewExpandedWorkspaces: [],
    });
    const next = applyWorkspaceSessionOrder(prefs, "/ws", ["c", "a", "b"]);
    assert.deepEqual(next.sessionOrderByWorkspace["/ws"], ["c", "a", "b"]);
    assert.deepEqual(next.pinnedSessions, ["a", "b"]);
  });

  it("normalizeSessionRailPrefs keeps sessionOrderByWorkspace", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedSessions: [],
      collapsedWorkspaces: [],
      previewExpandedWorkspaces: [],
      sessionOrderByWorkspace: { "/ws": ["b", "a", "a", ""] },
    });
    assert.deepEqual(prefs.sessionOrderByWorkspace, { "/ws": ["b", "a"] });
  });

  it("workspaceParentPath returns parent segments", () => {
    assert.equal(
      workspaceParentPath("/Users/me/code/grok-desktop"),
      "/Users/me/code",
    );
    assert.equal(workspaceParentPath("/alone"), "");
    assert.equal(workspaceParentPath("(no project)"), "");
  });
});
