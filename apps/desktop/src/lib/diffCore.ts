/**
 * Structured line-diff adapter over jsdiff (D4).
 * Produces dual line numbers, collapsible unmodified gaps, and a degraded
 * path when maxEditLength / size gates fire. Pure: no DOM, no store.
 */

import { structuredPatch } from "diff";

/** Max Myers edit length before jsdiff returns undefined (bail). */
export const DIFF_MAX_EDIT_LENGTH = 2000;

/** Lines of context around each change in structuredPatch hunks. */
export const DIFF_CONTEXT_LINES = 3;

/** Skip running diff when either side exceeds this many lines. */
export const DIFF_MAX_LINES = 20_000;

/** Skip running diff when either side exceeds this many UTF-16 code units. */
export const DIFF_MAX_CHARS = 2 * 1024 * 1024;

/**
 * One visual diff row. `del` has only oldNo, `add` only newNo, `same` both.
 * Text never includes the unified-diff prefix character.
 */
export type DiffRow = {
  type: "same" | "add" | "del";
  text: string;
  /** 1-based old-file line number; undefined on add rows. */
  oldNo?: number;
  /** 1-based new-file line number; undefined on del rows. */
  newNo?: number;
};

/**
 * Collapsed unmodified span between hunks (or before/after).
 * `count` is the number of omitted same-lines; start indexes are 1-based.
 */
export type DiffGap = {
  kind: "gap";
  count: number;
  oldStart: number;
  newStart: number;
};

/** One structuredPatch hunk with dual-numbered rows (includes context). */
export type DiffHunkBlock = {
  kind: "hunk";
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  rows: DiffRow[];
};

/** Full file-level structured diff for preview rendering. */
export type FileDiff = {
  blocks: Array<DiffHunkBlock | DiffGap>;
  added: number;
  removed: number;
  /**
   * True when maxEditLength or size gates forced a whole-file replace view.
   * UI must show an explicit degraded banner.
   */
  degraded?: boolean;
};

/**
 * Count logical lines the same way jsdiff does for size gates.
 * Empty string → 0 lines; trailing newline does not add an extra empty line.
 * @param text Source text; null/undefined treated as empty.
 */
export function countContentLines(text: string | undefined | null): number {
  if (text == null || text === "") {
    return 0;
  }
  const s = String(text);
  if (s.endsWith("\n")) {
    return s.slice(0, -1).split("\n").length;
  }
  return s.split("\n").length;
}

/**
 * Build a structured file diff with dual line numbers and collapsible gaps.
 * Uses jsdiff structuredPatch; on bail or size gate returns a single degraded
 * hunk (all del then all add).
 * @param oldText Prior content (empty for new files).
 * @param newText Proposed content.
 * @param options Optional context / maxEditLength overrides (tests).
 * @returns FileDiff with blocks, counts, and optional degraded flag.
 */
export function buildFileDiff(
  oldText: string | undefined | null,
  newText: string | undefined | null,
  options?: { context?: number; maxEditLength?: number },
): FileDiff {
  const old = oldText == null ? "" : String(oldText);
  const next = newText == null ? "" : String(newText);
  const context = options?.context ?? DIFF_CONTEXT_LINES;
  const maxEditLength = options?.maxEditLength ?? DIFF_MAX_EDIT_LENGTH;

  if (old === next) {
    return { blocks: [], added: 0, removed: 0 };
  }

  const oldLines = countContentLines(old);
  const newLines = countContentLines(next);
  if (
    oldLines > DIFF_MAX_LINES ||
    newLines > DIFF_MAX_LINES ||
    old.length > DIFF_MAX_CHARS ||
    next.length > DIFF_MAX_CHARS
  ) {
    return buildDegradedDiff(old, next);
  }

  const patch = structuredPatch(
    "old",
    "new",
    old,
    next,
    "",
    "",
    { context, maxEditLength },
  );

  if (patch == null || !Array.isArray(patch.hunks)) {
    return buildDegradedDiff(old, next);
  }

  return blocksFromHunks(patch.hunks, oldLines, newLines, context);
}

/**
 * Whole-file replace view when the real diff is too large or timed out.
 * @param old Prior text.
 * @param next Proposed text.
 */
function buildDegradedDiff(old: string, next: string): FileDiff {
  const oldParts = splitLinesKeepEmpty(old);
  const newParts = splitLinesKeepEmpty(next);
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const text of oldParts) {
    rows.push({ type: "del", text, oldNo });
    oldNo += 1;
  }
  for (const text of newParts) {
    rows.push({ type: "add", text, newNo });
    newNo += 1;
  }
  return {
    blocks: [
      {
        kind: "hunk",
        oldStart: oldParts.length > 0 ? 1 : 0,
        oldCount: oldParts.length,
        newStart: newParts.length > 0 ? 1 : 0,
        newCount: newParts.length,
        rows,
      },
    ],
    added: newParts.length,
    removed: oldParts.length,
    degraded: true,
  };
}

/**
 * Split into display lines without inventing a trailing empty segment.
 * @param text Source text.
 */
function splitLinesKeepEmpty(text: string): string[] {
  if (text === "") {
    return [];
  }
  if (text.endsWith("\n")) {
    return text.slice(0, -1).split("\n");
  }
  return text.split("\n");
}

type JsHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

/**
 * Map jsdiff hunks to DiffHunkBlock / DiffGap with dual line numbers.
 * Gaps with count ≤ context*2 stay expanded (not folded).
 * @param hunks Raw structuredPatch hunks.
 * @param oldTotal Line count of old file (for trailing gap).
 * @param newTotal Line count of new file.
 * @param context Context lines used for the patch (fold threshold).
 */
function blocksFromHunks(
  hunks: JsHunk[],
  oldTotal: number,
  newTotal: number,
  context: number,
): FileDiff {
  const blocks: Array<DiffHunkBlock | DiffGap> = [];
  let added = 0;
  let removed = 0;
  const foldMin = context * 2 + 1;
  let prevOldEnd = 1;
  let prevNewEnd = 1;

  for (const hunk of hunks) {
    const gapOld = hunk.oldStart - prevOldEnd;
    const gapNew = hunk.newStart - prevNewEnd;
    const gapCount = Math.max(gapOld, gapNew);
    if (gapCount >= foldMin) {
      blocks.push({
        kind: "gap",
        count: gapCount,
        oldStart: prevOldEnd,
        newStart: prevNewEnd,
      });
    }

    const rows: DiffRow[] = [];
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const raw of hunk.lines) {
      if (raw.startsWith("\\")) {
        // jsdiff "\ No newline at end of file" marker — skip for display.
        continue;
      }
      const mark = raw.charAt(0);
      const text = raw.slice(1);
      if (mark === "+") {
        rows.push({ type: "add", text, newNo });
        newNo += 1;
        added += 1;
      } else if (mark === "-") {
        rows.push({ type: "del", text, oldNo });
        oldNo += 1;
        removed += 1;
      } else {
        // space or unexpected: treat as context
        rows.push({ type: "same", text, oldNo, newNo });
        oldNo += 1;
        newNo += 1;
      }
    }

    blocks.push({
      kind: "hunk",
      oldStart: hunk.oldStart,
      oldCount: hunk.oldLines,
      newStart: hunk.newStart,
      newCount: hunk.newLines,
      rows,
    });
    prevOldEnd = hunk.oldStart + hunk.oldLines;
    prevNewEnd = hunk.newStart + hunk.newLines;
  }

  const trailOld = oldTotal - (prevOldEnd - 1);
  const trailNew = newTotal - (prevNewEnd - 1);
  const trailCount = Math.max(trailOld, trailNew);
  if (trailCount >= foldMin) {
    blocks.push({
      kind: "gap",
      count: trailCount,
      oldStart: prevOldEnd,
      newStart: prevNewEnd,
    });
  }

  return { blocks, added, removed };
}

/**
 * Flatten FileDiff blocks into a linear DiffRow list (gaps expanded as same).
 * Used by buildLineDiff compatibility layer; gaps are omitted for review hunks.
 * @param fileDiff Structured diff.
 * @param includeGaps When false (default), only hunk rows are emitted.
 */
export function flattenFileDiffRows(
  fileDiff: FileDiff,
  includeGaps = false,
): DiffRow[] {
  const out: DiffRow[] = [];
  for (const block of fileDiff.blocks) {
    if (block.kind === "hunk") {
      out.push(...block.rows);
      continue;
    }
    if (!includeGaps) {
      continue;
    }
    for (let i = 0; i < block.count; i += 1) {
      out.push({
        type: "same",
        text: "",
        oldNo: block.oldStart + i,
        newNo: block.newStart + i,
      });
    }
  }
  return out;
}
