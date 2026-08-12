/**
 * Unit tests for preview path kind classification (doc vs code whitelist).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOC_RENDER_MAX_CHARS,
  extensionOfPath,
  previewFileKind,
} from "@/lib/previewFileKind";

describe("previewFileKind", () => {
  it("classifies Markdown whitelist extensions as doc (case-insensitive)", () => {
    assert.equal(previewFileKind("docs/readme.md"), "doc");
    assert.equal(previewFileKind("docs/README.MD"), "doc");
    assert.equal(previewFileKind("/abs/path/notes.markdown"), "doc");
    assert.equal(previewFileKind("x.mdx"), "doc");
    assert.equal(previewFileKind("A.Markdown"), "doc");
  });

  it("classifies non-doc extensions and missing extension as code", () => {
    assert.equal(previewFileKind("src/main.ts"), "code");
    assert.equal(previewFileKind("package.json"), "code");
    assert.equal(previewFileKind("Makefile"), "code");
    assert.equal(previewFileKind(""), "code");
    assert.equal(previewFileKind("   "), "code");
    assert.equal(previewFileKind("path/to/dir/"), "code");
  });

  it("only uses the final extension (README.md.bak stays code)", () => {
    assert.equal(previewFileKind("README.md.bak"), "code");
    assert.equal(extensionOfPath("README.md.bak"), "bak");
    assert.equal(extensionOfPath("notes.md"), "md");
    assert.equal(extensionOfPath(".gitignore"), "");
  });

  it("exports the render char cap used by the file orchestrator", () => {
    assert.equal(DOC_RENDER_MAX_CHARS, 200_000);
  });
});
