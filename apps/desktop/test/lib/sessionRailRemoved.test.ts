/**
 * "Remove project" rules for the session rail: mark, hide, revive, busy
 * guard, and where the canvas goes when the open chat's folder is removed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSessionRailPrefs } from "@/lib/sessionRailPrefs";
import {
  busyWorkspaceKeys,
  dropHiddenProjectRows,
  forgetRemovedWorkspaces,
  isBusySessionStatus,
  isRowInProject,
  markWorkspaceRemoved,
  nextChatAfterRemoval,
  resolveRemovedWorkspaces,
} from "@/lib/sessionRailRemoved";
import type { SessionRecord } from "@/store/sessionCatalog";

/**
 * Minimal rail row.
 * @param id Session id.
 * @param workspace Folder path ("" = no project).
 * @param createdAt Creation time (revival compares this to the removal).
 * @param extra Overrides (`noProject`, `updatedAt`, …).
 */
function row(
  id: string,
  workspace: string,
  createdAt: number,
  extra: Partial<SessionRecord> = {},
): SessionRecord {
  return {
    id,
    workspace,
    title: id,
    mode: "build",
    model: "",
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    timeline: [],
    toolCalls: {},
    lastAgentText: "",
    ...extra,
  };
}

describe("markWorkspaceRemoved", () => {
  it("stores the normalized folder key with the removal time", () => {
    const prefs = markWorkspaceRemoved(normalizeSessionRailPrefs({}), "/ws/a/", 100);
    assert.deepEqual(prefs.removedWorkspaces, { "/ws/a": 100 });
  });

  it("refreshes the time when the folder is removed again", () => {
    const once = markWorkspaceRemoved(normalizeSessionRailPrefs({}), "/ws/a", 100);
    const twice = markWorkspaceRemoved(once, "/ws/a", 250);
    assert.deepEqual(twice.removedWorkspaces, { "/ws/a": 250 });
  });

  it("ignores an empty path and the no-project key", () => {
    const prefs = normalizeSessionRailPrefs({});
    assert.equal(markWorkspaceRemoved(prefs, "  ", 100), prefs);
    assert.equal(markWorkspaceRemoved(prefs, "(no project)", 100), prefs);
  });

  it("does not touch pins, collapse, or drag order", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedSessions: ["s1"],
      collapsedWorkspaces: ["/ws/a"],
      sessionOrderByWorkspace: { "/ws/a": ["s2", "s1"] },
    });
    const next = markWorkspaceRemoved(prefs, "/ws/a", 100);
    assert.deepEqual(next.pinnedSessions, ["s1"]);
    assert.deepEqual(next.collapsedWorkspaces, ["/ws/a"]);
    assert.deepEqual(next.sessionOrderByWorkspace, { "/ws/a": ["s2", "s1"] });
  });
});

describe("resolveRemovedWorkspaces", () => {
  it("hides a removed folder whose chats all predate the removal", () => {
    const rows = [row("a1", "/ws/a", 10), row("a2", "/ws/a/", 20)];
    const state = resolveRemovedWorkspaces(rows, { "/ws/a": 50 });
    assert.deepEqual([...state.hidden], ["/ws/a"]);
    assert.deepEqual(state.revived, []);
  });

  it("revives the folder once a chat there is created after the removal", () => {
    const rows = [row("a1", "/ws/a", 10), row("a3", "/ws/a", 60)];
    const state = resolveRemovedWorkspaces(rows, { "/ws/a": 50 });
    assert.equal(state.hidden.size, 0);
    assert.deepEqual(state.revived, ["/ws/a"]);
  });

  it("never lets a no-project chat filed under the folder revive it", () => {
    const rows = [
      row("a1", "/ws/a", 10),
      row("loose", "/ws/a", 60, { noProject: true }),
    ];
    const state = resolveRemovedWorkspaces(rows, { "/ws/a": 50 });
    assert.deepEqual([...state.hidden], ["/ws/a"]);
    assert.deepEqual(state.revived, []);
  });

  it("is empty when nothing was removed", () => {
    const state = resolveRemovedWorkspaces([row("a1", "/ws/a", 10)], {});
    assert.equal(state.hidden.size, 0);
    assert.deepEqual(state.revived, []);
  });
});

describe("dropHiddenProjectRows", () => {
  it("drops only hidden folders and keeps no-project rows on the same path", () => {
    const rows = [
      row("a1", "/ws/a/", 10),
      row("b1", "/ws/b", 10),
      row("loose", "/ws/a", 10, { noProject: true }),
      row("empty", "", 10),
    ];
    const kept = dropHiddenProjectRows(rows, new Set(["/ws/a"]));
    assert.deepEqual(
      kept.map((r) => r.id),
      ["b1", "loose", "empty"],
    );
  });

  it("returns the same array when nothing is hidden", () => {
    const rows = [row("a1", "/ws/a", 10)];
    assert.equal(dropHiddenProjectRows(rows, new Set()), rows);
  });
});

describe("forgetRemovedWorkspaces", () => {
  it("drops the given marks and keeps the rest", () => {
    const prefs = normalizeSessionRailPrefs({
      removedWorkspaces: { "/ws/a": 50, "/ws/b": 60 },
    });
    const next = forgetRemovedWorkspaces(prefs, ["/ws/a"]);
    assert.deepEqual(next.removedWorkspaces, { "/ws/b": 60 });
  });

  it("returns the same prefs when no key is marked", () => {
    const prefs = normalizeSessionRailPrefs({
      removedWorkspaces: { "/ws/b": 60 },
    });
    assert.equal(forgetRemovedWorkspaces(prefs, ["/ws/a"]), prefs);
    assert.equal(forgetRemovedWorkspaces(prefs, []), prefs);
  });
});

describe("busy guard", () => {
  it("counts streaming and waiting-for-approval chats only", () => {
    assert.equal(isBusySessionStatus("streaming"), true);
    assert.equal(isBusySessionStatus("waiting_permission"), true);
    assert.equal(isBusySessionStatus("idle"), false);
    assert.equal(isBusySessionStatus("disconnected"), false);
    assert.equal(isBusySessionStatus(undefined), false);
  });

  it("collects busy folders from live statuses, skipping no-project rows", () => {
    const rows = [
      row("a1", "/ws/a/", 10),
      row("b1", "/ws/b", 10),
      row("loose", "/ws/c", 10, { noProject: true }),
    ];
    const live: Record<string, string> = {
      a1: "streaming",
      b1: "idle",
      loose: "waiting_permission",
    };
    const busy = busyWorkspaceKeys(rows, (rec) => live[rec.id]);
    assert.deepEqual([...busy], ["/ws/a"]);
  });
});

describe("isRowInProject", () => {
  it("matches the folder across trailing slashes, never for no-project rows", () => {
    assert.equal(isRowInProject(row("a1", "/ws/a/", 10), "/ws/a"), true);
    assert.equal(isRowInProject(row("b1", "/ws/b", 10), "/ws/a"), false);
    assert.equal(
      isRowInProject(row("loose", "/ws/a", 10, { noProject: true }), "/ws/a"),
      false,
    );
  });
});

describe("nextChatAfterRemoval", () => {
  it("picks the most recently active chat outside the removed folder", () => {
    const rows = [
      row("a1", "/ws/a", 10, { updatedAt: 900 }),
      row("b1", "/ws/b", 10, { updatedAt: 300 }),
      row("loose", "", 10, { updatedAt: 500 }),
    ];
    assert.equal(nextChatAfterRemoval(rows, "/ws/a/"), "loose");
  });

  it("returns null when the rail has nothing else", () => {
    assert.equal(nextChatAfterRemoval([row("a1", "/ws/a", 10)], "/ws/a"), null);
    assert.equal(nextChatAfterRemoval([], "/ws/a"), null);
  });
});
