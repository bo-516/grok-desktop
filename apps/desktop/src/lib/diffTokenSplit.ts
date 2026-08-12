/**
 * Split syntax tokens at word-emphasis range boundaries so emph classes can
 * wrap only the changed character spans. EmphRange is line-local; CodeToken
 * offset is file-global — callers pass `base` (first token offset on the line,
 * or 0 for empty lines) so the two coordinate systems never mix silently.
 */

import type { CodeToken } from "./codeHighlight";
import type { EmphRange } from "./diffWordRanges";

/**
 * One rendered span after token × range intersection.
 * `emph` marks fragments that fall inside an EmphRange.
 */
export type SplitToken = {
  /** Raw text fragment (concatenation of all fragments === original line). */
  content: string;
  /** Syntax kind from the parent token (or plain for synthetic pieces). */
  kind: CodeToken["kind"];
  /**
   * Stable React key: file-global start of this fragment.
   * Unique within a line as long as tokens do not overlap.
   */
  offset: number;
  /** True when this fragment lies inside a word-emphasis range. */
  emph: boolean;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
};

/**
 * Intersect tokens with line-local emph ranges, splitting at range edges.
 * Property: `result.map(t => t.content).join("") ===` the original line text
 * when tokens cover that line without gaps.
 *
 * @param tokens Tokens for one line (offsets may be file-global).
 * @param ranges Line-local emph ranges (start/end relative to line start).
 * @param base File-global offset of line start = `tokens[0]?.offset ?? 0`.
 *   Empty token arrays return [] immediately (no emph on empty lines).
 * @returns Ordered fragments with emph flags; empty tokens → empty list.
 */
export function splitTokensByRanges(
  tokens: CodeToken[] | undefined,
  ranges: EmphRange[] | undefined,
  base: number,
): SplitToken[] {
  if (!tokens || tokens.length === 0) {
    return [];
  }
  const activeRanges = normalizeRanges(ranges);
  const out: SplitToken[] = [];

  for (const token of tokens) {
    const tokenStart = token.offset - base;
    const tokenEnd = tokenStart + token.content.length;
    if (token.content.length === 0) {
      continue;
    }
    // Local cut points inside this token: 0, length, and every range edge that falls inside.
    const cuts = new Set<number>([0, token.content.length]);
    for (const r of activeRanges) {
      if (r.end <= tokenStart || r.start >= tokenEnd) {
        continue;
      }
      const localStart = Math.max(0, r.start - tokenStart);
      const localEnd = Math.min(token.content.length, r.end - tokenStart);
      cuts.add(localStart);
      cuts.add(localEnd);
    }
    const ordered = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (a === undefined || b === undefined || a >= b) {
        continue;
      }
      const lineStart = tokenStart + a;
      const lineEnd = tokenStart + b;
      out.push({
        content: token.content.slice(a, b),
        kind: token.kind,
        offset: token.offset + a,
        emph: covers(activeRanges, lineStart, lineEnd),
        italic: token.italic,
        bold: token.bold,
        underline: token.underline,
      });
    }
  }
  return out;
}

/**
 * Drop empty / inverted ranges and sort by start.
 * @param ranges Raw emph ranges; undefined/empty → no emph.
 */
function normalizeRanges(ranges: EmphRange[] | undefined): EmphRange[] {
  if (!ranges || ranges.length === 0) {
    return [];
  }
  return ranges
    .filter((r) => r.end > r.start && r.start >= 0)
    .sort((a, b) => a.start - b.start);
}

/**
 * Whether [start, end) is fully inside some emph range (partial coverage still
 * counts when the fragment was cut to lie entirely inside a range).
 * @param ranges Normalized ranges.
 * @param start Line-local start.
 * @param end Line-local end (exclusive).
 */
function covers(ranges: EmphRange[], start: number, end: number): boolean {
  if (end <= start) {
    return false;
  }
  for (const r of ranges) {
    if (start >= r.start && end <= r.end) {
      return true;
    }
  }
  return false;
}
