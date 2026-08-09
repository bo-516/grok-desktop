/**
 * Workspace path boundary tests (TC-REV-04 / F-REV-09).
 * Drives shipped resolveWorkspacePath / isPathInsideWorkspace — no reimplementation.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  isPathInsideWorkspace,
  resolveWorkspacePath,
} from "./workspacePath.js";

describe("workspacePath boundary", () => {
  const root = path.resolve("/x/demo");

  it("allows files inside workspace", () => {
    assert.equal(
      resolveWorkspacePath(root, "src/math.ts"),
      path.resolve(root, "src/math.ts"),
    );
    assert.equal(isPathInsideWorkspace(root, path.join(root, "a")), true);
    assert.equal(isPathInsideWorkspace(root, root), true);
  });

  it("rejects parent traversal", () => {
    assert.throws(
      () => resolveWorkspacePath(root, "../../etc/passwd"),
      /outside workspace/,
    );
    assert.throws(
      () => resolveWorkspacePath(root, "foo/../../../etc/passwd"),
      /outside workspace/,
    );
  });

  it("rejects prefix-neighbor directories (startsWith false positive)", () => {
    // cwd=/x/demo must NOT accept /x/demo-evil/...
    assert.equal(
      isPathInsideWorkspace(root, path.resolve("/x/demo-evil/f")),
      false,
    );
    assert.throws(
      () => resolveWorkspacePath(root, "../demo-evil/secret"),
      /outside workspace/,
    );
  });

  it("rejects absolute paths outside workspace", () => {
    assert.throws(
      () => resolveWorkspacePath(root, "/etc/passwd"),
      /outside workspace/,
    );
    assert.throws(
      () => resolveWorkspacePath(root, "/x/other/file"),
      /outside workspace/,
    );
  });
});
