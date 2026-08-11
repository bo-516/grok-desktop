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
} from "../src/workspacePath.js";

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

  it("allows basename starting with .. that is not parent traversal", () => {
    // Node previously used startsWith("..") which false-denied ..foo
    assert.equal(
      isPathInsideWorkspace(root, path.join(root, "..foo")),
      true,
    );
  });

  it("rejects symlink that escapes workspace (QA-REV-14)", async () => {
    const { mkdtemp, symlink, mkdir, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const dir = await mkdtemp(path.join(os.tmpdir(), "ws-symlink-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "ws-out-"));
    await writeFile(path.join(outside, "secret.txt"), "leak", "utf8");
    await symlink(outside, path.join(dir, "escape"), "dir");
    assert.throws(
      () => resolveWorkspacePath(dir, "escape/secret.txt"),
      /outside workspace/,
    );
    // Control: normal file still works (compare realpath — macOS /var → /private/var).
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "ok.ts"), "ok", "utf8");
    const { realpathSync } = await import("node:fs");
    assert.equal(
      resolveWorkspacePath(dir, "src/ok.ts"),
      realpathSync(path.join(dir, "src", "ok.ts")),
    );
  });
});
