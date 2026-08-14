/**
 * Default workspace resolver: repo in a checkout, Documents/Grok otherwise.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  PRODUCT_WORKSPACE_FOLDER,
  REPO_MARKER,
  findRepoRoot,
  productionWorkspaceDir,
  resolveDefaultWorkspaceCwd,
  userDocumentsDir,
} from "../src/defaultWorkspace.js";

/**
 * Build a fake monorepo with the same marker the product walk looks for.
 * @returns Absolute fake repo root.
 */
function fakeRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "grok-repo-"));
  const markerDir = path.join(root, path.dirname(REPO_MARKER));
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(path.join(root, REPO_MARKER), "// marker\n");
  return root;
}

describe("findRepoRoot", () => {
  it("walks up from a nested path to the marker", () => {
    const root = fakeRepo();
    const nested = path.join(root, "apps", "desktop", "src");
    mkdirSync(nested, { recursive: true });
    assert.equal(findRepoRoot(nested), root);
    assert.equal(findRepoRoot(root), root);
  });

  it("returns null when no checkout is nearby", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "grok-bare-"));
    assert.equal(findRepoRoot(bare), null);
  });
});

describe("userDocumentsDir / productionWorkspaceDir", () => {
  it("uses HOME/Documents/Grok on every OS", () => {
    const home = "/Users/dev";
    const env = { HOME: home, USERPROFILE: home };
    assert.equal(userDocumentsDir(env), path.join(home, "Documents"));
    assert.equal(
      productionWorkspaceDir(env),
      path.join(home, "Documents", PRODUCT_WORKSPACE_FOLDER),
    );
  });

  it("prefers XDG_DOCUMENTS_DIR when set", () => {
    const env = {
      HOME: "/home/dev",
      XDG_DOCUMENTS_DIR: "/mnt/docs",
    };
    assert.equal(userDocumentsDir(env), path.resolve("/mnt/docs"));
    assert.equal(
      productionWorkspaceDir(env),
      path.join(path.resolve("/mnt/docs"), PRODUCT_WORKSPACE_FOLDER),
    );
  });

  it("falls back to USERPROFILE when HOME is empty", () => {
    const env = { USERPROFILE: "C:\\Users\\dev" };
    assert.equal(
      userDocumentsDir(env),
      path.join("C:\\Users\\dev", "Documents"),
    );
  });
});

describe("resolveDefaultWorkspaceCwd", () => {
  it("BRIDGE_CWD wins over repo and Documents", () => {
    const root = fakeRepo();
    const cwd = resolveDefaultWorkspaceCwd({
      startDir: root,
      env: {
        BRIDGE_CWD: "/tmp/explicit-ws",
        HOME: "/Users/dev",
      },
    });
    assert.equal(cwd, path.resolve("/tmp/explicit-ws"));
  });

  it("uses the monorepo root when running from a checkout", () => {
    const root = fakeRepo();
    const cwd = resolveDefaultWorkspaceCwd({
      startDir: path.join(root, "apps", "bridge", "src"),
      env: { HOME: "/Users/dev" },
    });
    assert.equal(cwd, root);
  });

  it("uses Documents/Grok when no checkout is nearby", () => {
    const bare = mkdtempSync(path.join(tmpdir(), "grok-prod-"));
    const home = mkdtempSync(path.join(tmpdir(), "grok-home-"));
    const cwd = resolveDefaultWorkspaceCwd({
      startDir: bare,
      env: { HOME: home, USERPROFILE: home },
    });
    assert.equal(
      cwd,
      path.join(home, "Documents", PRODUCT_WORKSPACE_FOLDER),
    );
  });
});
