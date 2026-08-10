/**
 * Session rail pin / collapse / drag-order prefs helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyWorkspaceSessionOrder,
  isSessionPinned,
  isWorkspaceCollapsed,
  moveSessionIdInOrder,
  normalizeSessionRailPrefs,
  orderGroupsBySessionPin,
  orderSessionsByPin,
  orderSessionsByTitleAscii,
  orderSessionsByUserThenAscii,
  toggleCollapsedWorkspace,
  togglePinnedSession,
  workspaceParentPath,
} from "@/lib/sessionRailPrefs";
import type { ProjectGroup, SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal catalog row for ordering tests.
 * @param id Session id (also used as title when title omitted).
 * @param updatedAt Recency ms (unused for rail auto-sort; kept for realism).
 * @param title Optional display title for ASCII sort tests.
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

describe("sessionRailPrefs", () => {
  it("normalizeSessionRailPrefs dedupes session pins and drops junk", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedSessions: ["a", "a", 1, "", "b"],
      collapsedWorkspaces: ["/b", "/b", null],
    });
    assert.deepEqual(prefs.pinnedSessions, ["a", "b"]);
    assert.deepEqual(prefs.collapsedWorkspaces, ["/b"]);
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

  it("toggleCollapsedWorkspace flips membership", () => {
    let prefs = normalizeSessionRailPrefs({});
    prefs = toggleCollapsedWorkspace(prefs, "/ws");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), true);
    prefs = toggleCollapsedWorkspace(prefs, "/ws");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), false);
  });

  it("orderSessionsByTitleAscii sorts by first character code unit", () => {
    const sessions = [
      rec("z", 1, "zeta"),
      rec("a", 9, "alpha"),
      rec("m", 5, "mu"),
    ];
    const ordered = orderSessionsByTitleAscii(sessions);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["a", "m", "z"],
    );
  });

  it("orderSessionsByUserThenAscii prefers drag order over title ASCII", () => {
    const sessions = [
      rec("a", 1, "alpha"),
      rec("b", 2, "beta"),
      rec("c", 3, "gamma"),
    ];
    const ordered = orderSessionsByUserThenAscii(sessions, ["c", "a"]);
    assert.deepEqual(
      ordered.map((s) => s.id),
      ["c", "a", "b"],
    );
  });

  it("orderSessionsByPin puts pinned ids first; drag then ASCII for rest", () => {
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
    });
    const next = applyWorkspaceSessionOrder(prefs, "/ws", ["c", "a", "b"]);
    assert.deepEqual(next.sessionOrderByWorkspace["/ws"], ["c", "a", "b"]);
    assert.deepEqual(next.pinnedSessions, ["a", "b"]);
  });

  it("normalizeSessionRailPrefs keeps sessionOrderByWorkspace", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedSessions: [],
      collapsedWorkspaces: [],
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
