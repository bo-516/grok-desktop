/**
 * Diff review + MCP name parse tests (TC-TOOL-04 shape / F-TOOL-08).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLineDiff,
  isCollapsibleToolKind,
  parseMcpToolName,
} from "./diffReview.js";

describe("diffReview", () => {
  it("handles new file (empty old)", () => {
    const h = buildLineDiff("", "a\nb");
    assert.equal(h.added, 2);
    assert.equal(h.removed, 0);
    assert.ok(h.lines.every((l) => l.type === "add" || l.type === "same"));
  });

  it("marks deletions and additions", () => {
    const h = buildLineDiff("a\nb\nc", "a\nx\nc");
    assert.ok(h.removed >= 1);
    assert.ok(h.added >= 1);
    assert.match(h.summary, /^\+\d+\/-\d+$/);
  });

  it("parses MCP server__tool names", () => {
    assert.deepEqual(parseMcpToolName("browser-use__open_page"), {
      server: "browser-use",
      tool: "open_page",
    });
    assert.equal(parseMcpToolName("plain"), null);
  });

  it("collapses read/search/list kinds", () => {
    assert.equal(isCollapsibleToolKind("read"), true);
    assert.equal(isCollapsibleToolKind("edit"), false);
  });
});
