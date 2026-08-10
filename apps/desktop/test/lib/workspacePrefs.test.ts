/**
 * Workspace / project prefs helpers for the rail project switcher.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectProjectWorkspacePaths,
  normalizeWorkspacePrefs,
  rememberAndActivateWorkspace,
  resolvePreferredWorkspace,
  setActiveWorkspacePrefs,
  workspaceDisplayName,
} from "@/lib/workspacePrefs";

describe("workspacePrefs", () => {
  it("normalizeWorkspacePrefs drops junk and trims", () => {
    const prefs = normalizeWorkspacePrefs({
      activeWorkspace: "  /a/b  ",
      knownWorkspaces: ["/x", "/x", "", 1, "/y"],
    });
    assert.equal(prefs.activeWorkspace, "/a/b");
    assert.deepEqual(prefs.knownWorkspaces, ["/x", "/y"]);
    assert.equal(prefs.noProject, false);
  });

  it("normalizeWorkspacePrefs keeps explicit noProject only when active empty", () => {
    const prefs = normalizeWorkspacePrefs({
      activeWorkspace: "",
      knownWorkspaces: [],
      noProject: true,
    });
    assert.equal(prefs.noProject, true);
    const withPath = normalizeWorkspacePrefs({
      activeWorkspace: "/a",
      noProject: true,
    });
    assert.equal(withPath.noProject, false);
  });

  it("rememberAndActivateWorkspace puts path first and sets active", () => {
    let prefs = normalizeWorkspacePrefs({
      activeWorkspace: "",
      knownWorkspaces: ["/old"],
    });
    prefs = rememberAndActivateWorkspace(prefs, "/new");
    assert.equal(prefs.activeWorkspace, "/new");
    assert.equal(prefs.noProject, false);
    assert.deepEqual(prefs.knownWorkspaces, ["/new", "/old"]);
    prefs = rememberAndActivateWorkspace(prefs, "");
    assert.equal(prefs.activeWorkspace, "");
    assert.equal(prefs.noProject, true);
    assert.deepEqual(prefs.knownWorkspaces, ["/new", "/old"]);
  });

  it("setActiveWorkspacePrefs toggles noProject on empty path", () => {
    const prefs = setActiveWorkspacePrefs(
      normalizeWorkspacePrefs({
        activeWorkspace: "/a",
        knownWorkspaces: ["/a"],
      }),
      "/b",
    );
    assert.equal(prefs.activeWorkspace, "/b");
    assert.equal(prefs.noProject, false);
    assert.deepEqual(prefs.knownWorkspaces, ["/a"]);
    const cleared = setActiveWorkspacePrefs(prefs, "");
    assert.equal(cleared.noProject, true);
    assert.equal(cleared.activeWorkspace, "");
  });

  it("resolvePreferredWorkspace respects noProject over session cwd", () => {
    assert.equal(
      resolvePreferredWorkspace(
        normalizeWorkspacePrefs({ noProject: true, activeWorkspace: "" }),
        "/bridge/default",
      ),
      "",
    );
    assert.equal(
      resolvePreferredWorkspace(
        normalizeWorkspacePrefs({ activeWorkspace: "/a" }),
        "/bridge/default",
      ),
      "/a",
    );
    assert.equal(
      resolvePreferredWorkspace(
        normalizeWorkspacePrefs({}),
        "/session/ws",
      ),
      "/session/ws",
    );
  });

  it("workspaceDisplayName uses basename", () => {
    assert.equal(workspaceDisplayName("/Users/me/code/grok-desktop"), "grok-desktop");
    assert.equal(workspaceDisplayName(""), "No project");
  });

  it("collectProjectWorkspacePaths merges and sorts by display name", () => {
    const paths = collectProjectWorkspacePaths(
      ["/z/zeta", "/a/alpha"],
      ["/m/mu"],
      "/c/current",
    );
    assert.deepEqual(paths, [
      "/a/alpha",
      "/c/current",
      "/m/mu",
      "/z/zeta",
    ]);
  });
});
