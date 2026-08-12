/**
 * Unit tests for document relative-path resolution and heading slugs.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveDocRelativePath, slugifyHeading } from "@/lib/docLinkPath";

describe("resolveDocRelativePath", () => {
  it("resolves same-dir and nested relative targets", () => {
    assert.equal(
      resolveDocRelativePath("/repo/docs/a.md", "./b.md"),
      "/repo/docs/b.md",
    );
    assert.equal(
      resolveDocRelativePath("/repo/docs/a.md", "nested/c.md"),
      "/repo/docs/nested/c.md",
    );
  });

  it("resolves parent segments", () => {
    assert.equal(
      resolveDocRelativePath("/repo/docs/a.md", "../src/x.ts"),
      "/repo/src/x.ts",
    );
  });

  it("leaves absolute targets unchanged", () => {
    assert.equal(
      resolveDocRelativePath("/repo/docs/a.md", "/abs/other.md"),
      "/abs/other.md",
    );
  });
});

describe("slugifyHeading", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugifyHeading("Hello World"), "hello-world");
    assert.equal(slugifyHeading("  0. 结论  "), "0-结论");
  });

  it("strips most punctuation", () => {
    assert.equal(slugifyHeading("A, B & C!"), "a-b-c");
  });
});
