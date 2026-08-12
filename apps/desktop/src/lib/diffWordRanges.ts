/**
 * Word-level emphasis ranges for paired del/add lines inside one change run.
 * Uses jsdiff `diffWordsWithSpace` (no extra package). Gates skip work when
 * a line or run is too large, or when the file is degraded — callers then show
 * row background only.
 */

import { diffWordsWithSpace } from "diff";

/** Inclusive-start exclusive-end character range within one line (not file-global). */
export type EmphRange = {
  /** 0-based start index in the line string. */
  start: number;
  /** 0-based end index (exclusive) in the line string. */
  end: number;
};

/** Skip word emph when any paired line exceeds this character length. */
export const WORD_EMPH_MAX_LINE_CHARS = 400;

/** Skip word emph when del+add lines in the run exceed this count. */
export const WORD_EMPH_MAX_RUN_LINES = 200;

/**
 * Minimum non-whitespace common-character ratio for a del/add pair to receive
 * word emph. Below this the edit is treated as a whole-line rewrite (row bg only).
 */
export const WORD_EMPH_MIN_SIMILARITY = 0.4;

/**
 * Compute word-level change ranges for paired del/add sequences in one run.
 * Pairing is by index (i-th del with i-th add) only when del and add counts are
 * equal — unequal runs are structural insert/delete/rewrite and skip word emph
 * entirely (row bg only). Extra gates: long line, huge run, degraded, low
 * non-whitespace similarity.
 *
 * @param dels Deleted line texts in document order.
 * @param adds Added line texts in document order.
 * @param options.degraded When true (fileDiff.degraded), skip word diff entirely.
 * @returns Parallel arrays of ranges; same length as dels / adds.
 */
export function wordRangesForRun(
  dels: string[],
  adds: string[],
  options?: { degraded?: boolean },
): { del: EmphRange[][]; add: EmphRange[][] } {
  const delOut: EmphRange[][] = dels.map(() => []);
  const addOut: EmphRange[][] = adds.map(() => []);

  if (options?.degraded) {
    return { del: delOut, add: addOut };
  }

  /*
   * Structural gate: unequal line counts are insert / delete / whole-block
   * rewrite. Index-pairing unrelated lines floods the UI with false word marks.
   */
  if (dels.length !== adds.length) {
    return { del: delOut, add: addOut };
  }

  const changeLineCount = dels.length + adds.length;
  if (changeLineCount > WORD_EMPH_MAX_RUN_LINES) {
    return { del: delOut, add: addOut };
  }

  for (let i = 0; i < dels.length; i += 1) {
    const delText = dels[i] ?? "";
    const addText = adds[i] ?? "";
    if (
      delText.length > WORD_EMPH_MAX_LINE_CHARS ||
      addText.length > WORD_EMPH_MAX_LINE_CHARS
    ) {
      continue;
    }
    const pair = rangesForPair(delText, addText);
    delOut[i] = pair.del;
    addOut[i] = pair.add;
  }
  return { del: delOut, add: addOut };
}

/**
 * Word-diff one del/add pair into emph ranges on each side.
 * Skips emph when non-whitespace common content is below WORD_EMPH_MIN_SIMILARITY
 * (whole-line rewrite — row background is enough).
 * @param del Deleted line text.
 * @param add Added line text.
 */
function rangesForPair(
  del: string,
  add: string,
): { del: EmphRange[]; add: EmphRange[] } {
  if (del === add) {
    return { del: [], add: [] };
  }
  const parts = diffWordsWithSpace(del, add);
  // Similarity over non-whitespace common spans only (spaces/`*` alone do not count).
  const common = parts
    .filter((p) => !p.added && !p.removed && (p.value ?? "").trim() !== "")
    .reduce((n, p) => n + (p.value ?? "").length, 0);
  const ratio = common / Math.max(del.length, add.length, 1);
  if (ratio < WORD_EMPH_MIN_SIMILARITY) {
    return { del: [], add: [] };
  }
  const delRanges: EmphRange[] = [];
  const addRanges: EmphRange[] = [];
  let delCursor = 0;
  let addCursor = 0;
  for (const part of parts) {
    const value = part.value ?? "";
    const len = value.length;
    if (part.removed) {
      if (len > 0) {
        delRanges.push({ start: delCursor, end: delCursor + len });
      }
      delCursor += len;
      continue;
    }
    if (part.added) {
      if (len > 0) {
        addRanges.push({ start: addCursor, end: addCursor + len });
      }
      addCursor += len;
      continue;
    }
    delCursor += len;
    addCursor += len;
  }
  return {
    del: mergeAdjacent(delRanges),
    add: mergeAdjacent(addRanges),
  };
}

/**
 * Merge adjacent or overlapping ranges so spans do not fragment on token noise.
 * @param ranges Sorted or unsorted ranges on one line.
 */
function mergeAdjacent(ranges: EmphRange[]): EmphRange[] {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const first = sorted[0];
  if (!first) {
    return [];
  }
  const out: EmphRange[] = [];
  let cur = { ...first };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (!next) {
      continue;
    }
    if (next.start <= cur.end) {
      cur.end = Math.max(cur.end, next.end);
    } else {
      out.push(cur);
      cur = { ...next };
    }
  }
  out.push(cur);
  return out;
}
