/**
 * Diff row → file-side token indexing. Guards the rule that keeps highlighted
 * diffs honest: a row is colored from the side it actually came from, and a
 * missing index degrades to plain text instead of borrowing a neighbour's line.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodeLine, CodeToken } from "@/lib/codeHighlight";
import { diffRowTokens } from "@/lib/diffLineTokens";

/**
 * One-token line whose content names the side and line it belongs to.
 * @param label Marker such as "old:2" used to assert which side was read.
 */
function line(label: string): CodeLine {
  return [{ content: label, kind: "plain", offset: 0 } satisfies CodeToken];
}

const oldLines: CodeLine[] = [line("old:1"), line("old:2"), line("old:3")];
const newLines: CodeLine[] = [line("new:1"), line("new:2")];

/**
 * Content of the tokens a row resolves to.
 * @param tokens Result of diffRowTokens.
 */
function contentOf(tokens: CodeLine | undefined): string | undefined {
  return tokens?.map((t) => t.content).join("");
}

describe("diffRowTokens", () => {
  it("reads del rows from the pre-edit side", () => {
    const tokens = diffRowTokens(
      { type: "del", oldNo: 2 },
      oldLines,
      newLines,
    );
    assert.equal(contentOf(tokens), "old:2");
  });

  it("reads add rows from the post-edit side", () => {
    const tokens = diffRowTokens({ type: "add", newNo: 1 }, oldLines, newLines);
    assert.equal(contentOf(tokens), "new:1");
  });

  it("prefers the new side for context rows carrying both numbers", () => {
    const tokens = diffRowTokens(
      { type: "same", oldNo: 3, newNo: 2 },
      oldLines,
      newLines,
    );
    assert.equal(contentOf(tokens), "new:2");
  });

  it("falls back to the old side when the new side has no tokens yet", () => {
    const tokens = diffRowTokens(
      { type: "same", oldNo: 1, newNo: 1 },
      oldLines,
      undefined,
    );
    assert.equal(contentOf(tokens), undefined);
    // Del rows still resolve while only the old side is highlighted.
    assert.equal(
      contentOf(diffRowTokens({ type: "del", oldNo: 1 }, oldLines, undefined)),
      "old:1",
    );
  });

  it("returns undefined rather than a neighbouring line when the index is out of range", () => {
    assert.equal(
      diffRowTokens({ type: "add", newNo: 99 }, oldLines, newLines),
      undefined,
    );
    assert.equal(diffRowTokens({ type: "same" }, oldLines, newLines), undefined);
    assert.equal(
      diffRowTokens({ type: "del", oldNo: 1 }, undefined, newLines),
      undefined,
    );
  });
});
