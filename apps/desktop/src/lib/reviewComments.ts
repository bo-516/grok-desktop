/**
 * Line comments on the git diff view ("review feedback" for the agent).
 * Pure helpers: the full ordered row list of a file diff, gutter selection
 * ranges, comment construction with a short code excerpt, and location
 * labels. Prompt composition lives in reviewPrompt.ts; persistence in
 * reviewCommentsStorage.ts. No React, no store, no bridge.
 */

import type { DiffRow, FileDiff } from "./diffCore";
import { diffRowKey } from "./diffChangeRuns";

/** Which file version a comment's line numbers refer to. */
export type ReviewSide = "new" | "old";

/** One excerpt line: unified-diff marker + source text. */
export type ReviewExcerptLine = {
  /** "+" added, "-" removed, " " unchanged context. */
  mark: "+" | "-" | " ";
  /** Line text (clipped to REVIEW_EXCERPT_LINE_MAX chars). */
  text: string;
};

/** One review comment anchored to a line or line range of a changed file. */
export type ReviewComment = {
  /** Stable id (list keys, delete). */
  id: string;
  /** Repo-relative path as git prints it (what the agent should open). */
  path: string;
  /**
   * "new" when any selected row exists in the current file (numbers are
   * current-file lines); "old" when every row is a removed line.
   */
  side: ReviewSide;
  /** First line (1-based) on `side`. */
  startLine: number;
  /** Last line (1-based, ≥ startLine) on `side`. */
  endLine: number;
  /** Up to REVIEW_EXCERPT_MAX_LINES diff rows of the selection. */
  excerpt: ReviewExcerptLine[];
  /** Rows of the selection left out of `excerpt` (0 when it is complete). */
  excerptOmitted: number;
  /** The reviewer's comment text (trimmed, non-empty). */
  body: string;
  /** Epoch ms when the comment was added. */
  createdAt: number;
};

/** The in-progress gutter selection of one file (anchor → focus, inclusive). */
export type DiffLineSelection = {
  /** Repo-relative path of the file being commented on. */
  path: string;
  /** diffRowKey of the first clicked row. */
  anchorKey: string;
  /** diffRowKey of the last clicked row (== anchorKey for one line). */
  focusKey: string;
};

/** Max diff rows copied into a comment excerpt. */
export const REVIEW_EXCERPT_MAX_LINES = 12;
/** Max characters kept per excerpt line. */
export const REVIEW_EXCERPT_LINE_MAX = 200;

/**
 * Line count of a text split on "\n" (a trailing "" is the final newline).
 * @param lines Split lines.
 * @returns Number of real lines.
 */
function lineCount(lines: readonly string[]): number {
  return lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

/**
 * Unchanged rows from (oldNo, newNo) up to, but excluding, newEnd.
 * @param oldNo First old line number.
 * @param newNo First new line number.
 * @param newEnd New line number to stop before.
 * @param newTextLines New file lines (text source).
 * @returns Same rows.
 */
function sameRows(oldNo: number, newNo: number, newEnd: number, newTextLines: readonly string[]): DiffRow[] {
  const out: DiffRow[] = [];
  for (let n = Math.max(newNo, 1); n < newEnd; n += 1) {
    out.push({ type: "same", text: newTextLines[n - 1] ?? "", oldNo: oldNo + (n - newNo), newNo: n });
  }
  return out;
}

/**
 * Every row of a file diff in document order, with folded gaps — and the
 * short leading / trailing context buildFileDiff leaves out — filled with
 * unchanged rows, so a selection can span hunks and folded context.
 * @param fileDiff Structured diff (buildFileDiff).
 * @param oldTextLines Old file split on "\n" (gap text fallback).
 * @param newTextLines New file split on "\n" (unchanged-row text source).
 * @returns Ordered rows; unchanged rows carry both line numbers.
 */
export function fullDiffRows(
  fileDiff: FileDiff,
  oldTextLines: readonly string[],
  newTextLines: readonly string[],
): DiffRow[] {
  const rows: DiffRow[] = [];
  let nextOld = 1;
  let nextNew = 1;
  for (const block of fileDiff.blocks) {
    if (block.kind === "gap") {
      for (let i = 0; i < block.count; i += 1) {
        const oldNo = block.oldStart + i;
        const newNo = block.newStart + i;
        rows.push({ type: "same", text: newTextLines[newNo - 1] ?? oldTextLines[oldNo - 1] ?? "", oldNo, newNo });
      }
      nextOld = block.oldStart + block.count;
      nextNew = block.newStart + block.count;
      continue;
    }
    rows.push(...sameRows(nextOld, nextNew, block.newStart, newTextLines));
    rows.push(...block.rows);
    nextOld = block.oldStart + block.oldCount;
    nextNew = block.newStart + block.newCount;
  }
  rows.push(...sameRows(nextOld, nextNew, lineCount(newTextLines) + 1, newTextLines));
  return rows;
}

/**
 * Rows between two keys (inclusive, either order).
 * @param rows Output of fullDiffRows.
 * @param anchorKey First clicked row key.
 * @param focusKey Last clicked row key.
 * @returns Contiguous slice, or [] when a key is not in `rows`.
 */
export function selectionRows(
  rows: readonly DiffRow[],
  anchorKey: string,
  focusKey: string,
): DiffRow[] {
  const a = rows.findIndex((r) => diffRowKey(r) === anchorKey);
  const b = rows.findIndex((r) => diffRowKey(r) === focusKey);
  if (a < 0 || b < 0) {
    return [];
  }
  return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Whether a row key falls inside the selection.
 * @param rows Ordered rows.
 * @param selection Current selection (null → false).
 * @param key Row key to test.
 * @returns True when key is between anchor and focus.
 */
export function isRowSelected(
  rows: readonly DiffRow[],
  selection: Pick<DiffLineSelection, "anchorKey" | "focusKey"> | null,
  key: string,
): boolean {
  if (!selection) {
    return false;
  }
  return selectionRows(rows, selection.anchorKey, selection.focusKey).some(
    (r) => diffRowKey(r) === key,
  );
}

/**
 * Line range a set of rows covers.
 * @param rows Selected rows (non-empty).
 * @returns Side and 1-based inclusive range, or null for no numbered rows.
 */
export function rowsLocation(
  rows: readonly DiffRow[],
): { side: ReviewSide; startLine: number; endLine: number } | null {
  const newNos = rows.flatMap((r) => (r.newNo === undefined ? [] : [r.newNo]));
  if (newNos.length > 0) {
    return { side: "new", startLine: Math.min(...newNos), endLine: Math.max(...newNos) };
  }
  const oldNos = rows.flatMap((r) => (r.oldNo === undefined ? [] : [r.oldNo]));
  if (oldNos.length > 0) {
    return { side: "old", startLine: Math.min(...oldNos), endLine: Math.max(...oldNos) };
  }
  return null;
}

/**
 * Diff marker for an excerpt row.
 * @param type Row type.
 * @returns "+", "-" or " ".
 */
function excerptMark(type: DiffRow["type"]): ReviewExcerptLine["mark"] {
  if (type === "add") {
    return "+";
  }
  if (type === "del") {
    return "-";
  }
  return " ";
}

/** Input for {@link buildReviewComment}. */
export type BuildReviewCommentInput = {
  /** Comment id (caller-generated so this stays pure). */
  id: string;
  /** Repo-relative file path. */
  path: string;
  /** Selected rows in document order. */
  rows: readonly DiffRow[];
  /** Raw comment text; trimmed. */
  body: string;
  /** Epoch ms timestamp. */
  now: number;
};

/**
 * Build a comment from a selection.
 * @param input Id, path, selected rows, text and time.
 * @returns Comment, or null when the text is blank or rows carry no line numbers.
 */
export function buildReviewComment(input: BuildReviewCommentInput): ReviewComment | null {
  const body = input.body.trim();
  const loc = rowsLocation(input.rows);
  if (!body || !loc || !input.path) {
    return null;
  }
  const kept = input.rows.slice(0, REVIEW_EXCERPT_MAX_LINES);
  return {
    id: input.id,
    path: input.path,
    side: loc.side,
    startLine: loc.startLine,
    endLine: loc.endLine,
    excerpt: kept.map((r) => ({
      mark: excerptMark(r.type),
      text: r.text.length > REVIEW_EXCERPT_LINE_MAX ? `${r.text.slice(0, REVIEW_EXCERPT_LINE_MAX)}…` : r.text,
    })),
    excerptOmitted: input.rows.length - kept.length,
    body,
    createdAt: input.now,
  };
}

/**
 * `path:line` / `path:start-end` label; removed-only selections say so.
 * @param c Comment location fields.
 * @returns Human / agent readable location.
 */
export function formatCommentLocation(
  c: Pick<ReviewComment, "path" | "side" | "startLine" | "endLine">,
): string {
  const range = c.startLine === c.endLine ? `${c.startLine}` : `${c.startLine}-${c.endLine}`;
  if (c.side === "old") {
    return `${c.path}:${range} (removed lines, numbered as in the previous version)`;
  }
  return `${c.path}:${range}`;
}

/**
 * Comments of one file whose range ends on a given row, for inline display
 * under that row. Matching uses the row's number on the comment's side.
 * @param comments All comments.
 * @param path File path.
 * @param row Painted row.
 * @returns Comments to show after the row.
 */
export function commentsEndingAtRow(
  comments: readonly ReviewComment[],
  path: string,
  row: DiffRow,
): ReviewComment[] {
  return comments.filter((c) => {
    if (c.path !== path) {
      return false;
    }
    if (c.side === "new") {
      return row.newNo === c.endLine;
    }
    return row.type === "del" && row.oldNo === c.endLine;
  });
}
