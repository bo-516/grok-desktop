/**
 * Session rail pin / collapse prefs helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isWorkspaceCollapsed,
  isWorkspacePinned,
  normalizeSessionRailPrefs,
  orderGroupsByPin,
  toggleCollapsedWorkspace,
  togglePinnedWorkspace,
  workspaceParentPath,
} from "@/lib/sessionRailPrefs";
import type { ProjectGroup } from "@/store/sessionCatalog";

function group(workspace: string, projectName: string): ProjectGroup {
  return {
    workspace,
    projectName,
    sessions: [],
  };
}

describe("sessionRailPrefs", () => {
  it("normalizeSessionRailPrefs dedupes and drops junk", () => {
    const prefs = normalizeSessionRailPrefs({
      pinnedWorkspaces: ["/a", "/a", 1, "", "/b"],
      collapsedWorkspaces: ["/b", "/b", null],
    });
    assert.deepEqual(prefs.pinnedWorkspaces, ["/a", "/b"]);
    assert.deepEqual(prefs.collapsedWorkspaces, ["/b"]);
  });

  it("togglePinnedWorkspace inserts new pins at front and unpins", () => {
    let prefs = normalizeSessionRailPrefs({
      pinnedWorkspaces: ["/old"],
      collapsedWorkspaces: [],
    });
    prefs = togglePinnedWorkspace(prefs, "/new");
    assert.deepEqual(prefs.pinnedWorkspaces, ["/new", "/old"]);
    assert.equal(isWorkspacePinned(prefs, "/new"), true);
    prefs = togglePinnedWorkspace(prefs, "/new");
    assert.deepEqual(prefs.pinnedWorkspaces, ["/old"]);
    assert.equal(isWorkspacePinned(prefs, "/new"), false);
  });

  it("toggleCollapsedWorkspace flips membership", () => {
    let prefs = normalizeSessionRailPrefs({});
    prefs = toggleCollapsedWorkspace(prefs, "/ws");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), true);
    prefs = toggleCollapsedWorkspace(prefs, "/ws");
    assert.equal(isWorkspaceCollapsed(prefs, "/ws"), false);
  });

  it("orderGroupsByPin puts pinned paths first in pin order", () => {
    const groups = [
      group("/c", "c"),
      group("/b", "b"),
      group("/a", "a"),
    ];
    const ordered = orderGroupsByPin(groups, ["/a", "/c"]);
    assert.deepEqual(
      ordered.map((g) => g.workspace),
      ["/a", "/c", "/b"],
    );
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
