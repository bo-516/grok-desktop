/**
 * Unit tests for background-task log preview cwd.
 * Absolute session-terminal paths must not use the project workspace.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAbsoluteFsPath,
  parentDirOfPath,
  previewLogReadCwd,
} from "@/lib/previewLogPath";

const WORKSPACE = "/Users/me/proj";
const SESSION_LOG =
  "/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/019ff6ed-c84e/terminal/call-87f9.log";

describe("parentDirOfPath", () => {
  it("returns the directory of a POSIX absolute path", () => {
    assert.equal(
      parentDirOfPath(SESSION_LOG),
      "/Users/me/.grok/sessions/%2FUsers%2Fme%2Fproj/019ff6ed-c84e/terminal",
    );
    assert.equal(parentDirOfPath("/tmp/terminal/call.log"), "/tmp/terminal");
    assert.equal(parentDirOfPath("/file.log"), "/");
  });

  it("returns empty for a bare name and empty input", () => {
    assert.equal(parentDirOfPath("call.log"), "");
    assert.equal(parentDirOfPath("   "), "");
  });
});

describe("isAbsoluteFsPath", () => {
  it("detects POSIX and Windows drive paths", () => {
    assert.equal(isAbsoluteFsPath("/tmp/a.log"), true);
    assert.equal(isAbsoluteFsPath("C:\\tmp\\a.log"), true);
    assert.equal(isAbsoluteFsPath("C:/tmp/a.log"), true);
    assert.equal(isAbsoluteFsPath("terminal/a.log"), false);
    assert.equal(isAbsoluteFsPath(""), false);
  });
});

describe("previewLogReadCwd", () => {
  it("sandboxes an absolute session log to its parent, not the project", () => {
    const cwd = previewLogReadCwd(SESSION_LOG, WORKSPACE);
    assert.equal(cwd, parentDirOfPath(SESSION_LOG));
    assert.notEqual(cwd, WORKSPACE);
    assert.match(cwd ?? "", /\/terminal$/);
  });

  it("keeps relative logs bound to the session workspace", () => {
    assert.equal(
      previewLogReadCwd("terminal/call.log", WORKSPACE),
      WORKSPACE,
    );
  });

  it("falls back to workspace when the log path is empty", () => {
    assert.equal(previewLogReadCwd("", WORKSPACE), WORKSPACE);
    assert.equal(previewLogReadCwd("  ", undefined), undefined);
  });
});
