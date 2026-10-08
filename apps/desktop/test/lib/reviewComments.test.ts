/**
 * Review comments on the git diff: full row list, gutter selection, comment
 * construction, location labels, prompt formatting and per-session storage.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFileDiff, type DiffRow } from "@/lib/diffCore";
import { diffRowKey } from "@/lib/diffChangeRuns";
import {
  buildReviewComment,
  commentsEndingAtRow,
  formatCommentLocation,
  fullDiffRows,
  isRowSelected,
  REVIEW_EXCERPT_MAX_LINES,
  rowsLocation,
  selectionRows,
  type ReviewComment,
} from "@/lib/reviewComments";
import {
  loadReviewComments,
  parseStoredReviewComments,
  REVIEW_COMMENTS_KEY_PREFIX,
  reviewSessionKey,
  saveReviewComments,
} from "@/lib/reviewCommentsStorage";
import { fenceFor, formatReviewPrompt, REVIEW_PROMPT_INTRO } from "@/lib/reviewPrompt";

/** In-memory Storage stub. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

const oldText = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const newText = oldText.replace("line 5\n", "line five\n").replace("line 25\n", "");
const fileDiff = buildFileDiff(oldText, newText);
const rows = fullDiffRows(fileDiff, oldText.split("\n"), newText.split("\n"));

/**
 * Key of the first row matching a predicate.
 * @param pred Row predicate.
 */
function keyOf(pred: (r: DiffRow) => boolean): string {
  const row = rows.find(pred);
  assert.ok(row, "row exists");
  return diffRowKey(row);
}

describe("fullDiffRows / selection", () => {
  it("covers every old and new line in order", () => {
    assert.equal(rows.filter((r) => r.newNo !== undefined).length, 29);
    assert.equal(rows.filter((r) => r.oldNo !== undefined).length, 30);
    assert.equal(rows.find((r) => r.newNo === 12)?.text, "line 12");
  });

  it("slices inclusive ranges in either click order", () => {
    const a = keyOf((r) => r.newNo === 4);
    const b = keyOf((r) => r.newNo === 6);
    const forward = selectionRows(rows, a, b);
    assert.deepEqual(selectionRows(rows, b, a), forward);
    assert.deepEqual(forward.map((r) => r.type), ["same", "del", "add", "same"]);
    assert.deepEqual(rowsLocation(forward), { side: "new", startLine: 4, endLine: 6 });
    assert.ok(isRowSelected(rows, { anchorKey: a, focusKey: b }, keyOf((r) => r.type === "del" && r.oldNo === 5)));
    assert.ok(!isRowSelected(rows, null, a));
    assert.deepEqual(selectionRows(rows, "nope", b), []);
  });

  it("uses old numbering for removed-only selections", () => {
    const del = keyOf((r) => r.type === "del" && r.oldNo === 25);
    assert.deepEqual(rowsLocation(selectionRows(rows, del, del)), { side: "old", startLine: 25, endLine: 25 });
  });
});

describe("buildReviewComment", () => {
  it("captures location, excerpt and trimmed text", () => {
    const sel = selectionRows(rows, keyOf((r) => r.newNo === 5), keyOf((r) => r.newNo === 5));
    const c = buildReviewComment({ id: "c1", path: "src/a.ts", rows: sel, body: "  rename  ", now: 7 });
    assert.deepEqual(c, {
      id: "c1",
      path: "src/a.ts",
      side: "new",
      startLine: 5,
      endLine: 5,
      excerpt: [{ mark: "+", text: "line five" }],
      excerptOmitted: 0,
      body: "rename",
      createdAt: 7,
    });
    assert.equal(buildReviewComment({ id: "c2", path: "a", rows: sel, body: "  ", now: 0 }), null);
    assert.equal(buildReviewComment({ id: "c3", path: "a", rows: [], body: "x", now: 0 }), null);
  });

  it("caps long excerpts", () => {
    const sel = selectionRows(rows, keyOf((r) => r.newNo === 1), keyOf((r) => r.newNo === 20));
    const c = buildReviewComment({ id: "c", path: "a", rows: sel, body: "x", now: 0 });
    assert.equal(c?.excerpt.length, REVIEW_EXCERPT_MAX_LINES);
    assert.equal(c?.excerptOmitted, sel.length - REVIEW_EXCERPT_MAX_LINES);
  });

  it("formats locations and finds the row a comment ends on", () => {
    const base = { path: "a.ts", side: "new" as const, startLine: 3, endLine: 3 };
    assert.equal(formatCommentLocation(base), "a.ts:3");
    assert.equal(formatCommentLocation({ ...base, endLine: 9 }), "a.ts:3-9");
    assert.match(formatCommentLocation({ ...base, side: "old" }), /^a\.ts:3 \(removed lines/);
    const comment = { ...base, id: "c", excerpt: [], excerptOmitted: 0, body: "b", createdAt: 0 } satisfies ReviewComment;
    assert.equal(commentsEndingAtRow([comment], "a.ts", { type: "same", text: "", oldNo: 3, newNo: 3 }).length, 1);
    assert.equal(commentsEndingAtRow([comment], "b.ts", { type: "same", text: "", oldNo: 3, newNo: 3 }).length, 0);
    assert.equal(commentsEndingAtRow([{ ...comment, side: "old" }], "a.ts", { type: "same", text: "", oldNo: 3, newNo: 4 }).length, 0);
  });
});

describe("formatReviewPrompt", () => {
  const comment: ReviewComment = {
    id: "c1",
    path: "src/a.ts",
    side: "new",
    startLine: 4,
    endLine: 6,
    excerpt: [
      { mark: " ", text: "line 4" },
      { mark: "-", text: "line 5" },
      { mark: "+", text: "line ```five```" },
    ],
    excerptOmitted: 2,
    body: "Use a constant.\nAnd add a test.",
    createdAt: 0,
  };

  it("numbers comments with location, fenced excerpt and text", () => {
    const text = formatReviewPrompt([comment, { ...comment, id: "c2", path: "b.ts", startLine: 1, endLine: 1, excerpt: [], excerptOmitted: 0, body: "Why?" }]);
    assert.ok(text.startsWith(REVIEW_PROMPT_INTRO));
    assert.ok(text.includes("1. src/a.ts:4-6\n   ````diff\n     line 4\n   - line 5\n   + line ```five```\n     … (2 more lines)\n   ````\n   Use a constant.\n   And add a test."));
    assert.ok(text.includes("2. b.ts:1\n   ```diff\n   ```\n   Why?"));
    assert.equal(formatReviewPrompt([]), "");
  });

  it("picks a fence longer than any backtick run", () => {
    assert.equal(fenceFor(["plain"]), "```");
    assert.equal(fenceFor(["a ```` b"]), "`````");
  });
});

describe("review comment storage", () => {
  const comment: ReviewComment = {
    id: "c1",
    path: "a.ts",
    side: "new",
    startLine: 1,
    endLine: 2,
    excerpt: [{ mark: "+", text: "x" }],
    excerptOmitted: 0,
    body: "fix",
    createdAt: 1,
  };

  it("keys by session, falling back to the draft workspace", () => {
    assert.equal(reviewSessionKey(" s1 ", "/ws"), "s1");
    assert.equal(reviewSessionKey("", "/ws"), "draft:/ws");
    assert.equal(reviewSessionKey("", ""), "");
  });

  it("round-trips, clears when empty and ignores unusable keys", () => {
    const storage = memoryStorage();
    saveReviewComments("s1", [comment], storage);
    assert.deepEqual(loadReviewComments("s1", storage), [comment]);
    assert.deepEqual(loadReviewComments("s2", storage), []);
    saveReviewComments("s1", [], storage);
    assert.equal(storage.getItem(REVIEW_COMMENTS_KEY_PREFIX + "s1"), null);
    saveReviewComments("", [comment], storage);
    assert.equal(storage.length, 0);
  });

  it("drops malformed entries and survives throwing storage", () => {
    assert.deepEqual(parseStoredReviewComments("{bad"), []);
    assert.deepEqual(parseStoredReviewComments(JSON.stringify({})), []);
    const stored = JSON.stringify([comment, { ...comment, body: " " }, { ...comment, startLine: 0 }, { ...comment, excerpt: [{ mark: "?", text: "" }] }]);
    assert.deepEqual(parseStoredReviewComments(stored), [comment]);
    const throwing = {
      ...memoryStorage(),
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    } as Storage;
    assert.deepEqual(loadReviewComments("s1", throwing), []);
    assert.doesNotThrow(() => saveReviewComments("s1", [comment], throwing));
  });
});
