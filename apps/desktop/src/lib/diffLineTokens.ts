/**
 * Map a diff row onto the syntax tokens of the file side it came from.
 *
 * Diff surfaces highlight the two *whole* texts and then index into them per
 * row, because a row taken alone loses the multi-line context TextMate needs —
 * a line inside a block comment or template literal would otherwise be colored
 * as if it started fresh. This helper is the shared indexing rule so the
 * structured diff and the hunk review cannot drift apart.
 */

import type { CodeLine } from "./codeHighlight";

/** Minimal row shape both DiffRow (diffCore) and DiffLine (diffReview) satisfy. */
export type DiffTokenRow = {
  type: "same" | "add" | "del";
  /** 1-based pre-edit line number; undefined on add rows. */
  oldNo?: number;
  /** 1-based post-edit line number; undefined on del rows. */
  newNo?: number;
};

/**
 * Pick the tokens belonging to one diff row.
 * @param row Row carrying its 1-based old/new line numbers.
 * @param oldLines Pre-edit tokens by 0-based line, or undefined if not highlighted.
 * @param newLines Post-edit tokens by 0-based line, or undefined if not highlighted.
 * @returns Tokens for this row's own text, or undefined to render it plain.
 *   `same` rows read the new side first: both sides hold identical text there,
 *   and the new side is the one guaranteed present for a newly added file.
 *   A missing index yields undefined rather than a neighbouring line's tokens,
 *   so a stale or short token array degrades to plain text instead of
 *   mis-coloring the row.
 */
export function diffRowTokens(
  row: DiffTokenRow,
  oldLines: CodeLine[] | undefined,
  newLines: CodeLine[] | undefined,
): CodeLine | undefined {
  if (row.type !== "del" && row.newNo !== undefined) {
    return newLines?.[row.newNo - 1];
  }
  if (row.oldNo !== undefined) {
    return oldLines?.[row.oldNo - 1];
  }
  return undefined;
}
