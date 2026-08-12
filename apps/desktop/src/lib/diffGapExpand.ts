/**
 * Expand collapsed unmodified gaps without re-running the diff engine.
 * Revealed rows are `same` slices of already-loaded old/new text; line numbers
 * stay continuous with adjacent hunks so change-run order is preserved.
 */

import type { DiffGap, DiffRow, FileDiff } from "./diffCore";

/** Lines revealed from the top / bottom of one gap (document order). */
export type GapReveal = {
  /** Lines taken from the gap start (continue the hunk above). */
  top: number;
  /** Lines taken from the gap end (continue the hunk below upward). */
  bottom: number;
};

/** One click reveals this many lines from the chosen edge. */
export const REVEAL_STEP = 20;

/**
 * When remaining lines are at or below this count, a step click reveals all
 * remaining so the UI never leaves a tiny residual band (e.g. 3 lines).
 */
export const REVEAL_ALL_BELOW = 30;

/**
 * Middle-gap dual edge buttons only when remaining count is above this.
 * At or below: single ⇕ (reveal all). 60 = 3× REVEAL_STEP so dual only when
 * one step cannot finish the band. Independent of REVEAL_ALL_BELOW.
 */
export const REVEAL_DUAL_ABOVE = 60;

/** Max file lines allowed for "show full file"; larger files disable the action. */
export const FULL_FILE_LINE_GATE = 5000;

/**
 * Gap position within the file block list — drives fold-band icon shape.
 * leading = first block is this gap; trailing = last block; middle = elsewhere.
 */
export type GapBandPosition = "leading" | "trailing" | "middle";

/**
 * Stable key for a gap's reveal state. oldStart/newStart are strictly
 * increasing within one FileDiff, so the pair is unique.
 * @param gap Gap metadata (1-based starts).
 */
export function gapRevealKey(gap: Pick<DiffGap, "oldStart" | "newStart">): string {
  return `${gap.oldStart}:${gap.newStart}`;
}

/**
 * Clamp a reveal so top + bottom never exceeds gap.count.
 * Excess is trimmed from bottom first, then top.
 * @param count Gap line count.
 * @param reveal Requested top/bottom; missing fields treated as 0.
 */
export function clampReveal(
  count: number,
  reveal?: Partial<GapReveal> | null,
): GapReveal {
  let top = Math.max(0, Math.floor(reveal?.top ?? 0));
  let bottom = Math.max(0, Math.floor(reveal?.bottom ?? 0));
  if (count <= 0) {
    return { top: 0, bottom: 0 };
  }
  if (top + bottom > count) {
    const overflow = top + bottom - count;
    const cutBottom = Math.min(bottom, overflow);
    bottom -= cutBottom;
    top = Math.max(0, top - (overflow - cutBottom));
  }
  return { top, bottom };
}

/**
 * Next reveal after a top-edge step click (⌄ — grow the hunk above downward).
 * Remaining ≤ REVEAL_ALL_BELOW reveals everything.
 * @param count Current gap count.
 * @param reveal Current reveal state.
 */
export function stepRevealTop(
  count: number,
  reveal?: Partial<GapReveal> | null,
): GapReveal {
  const cur = clampReveal(count, reveal);
  const remaining = count - cur.top - cur.bottom;
  if (remaining <= 0) {
    return cur;
  }
  if (remaining <= REVEAL_ALL_BELOW) {
    return clampReveal(count, { top: cur.top + remaining, bottom: cur.bottom });
  }
  return clampReveal(count, { top: cur.top + REVEAL_STEP, bottom: cur.bottom });
}

/**
 * Next reveal after a bottom-edge step click (⌃ — grow the hunk below upward).
 * Remaining ≤ REVEAL_ALL_BELOW reveals everything.
 * @param count Current gap count.
 * @param reveal Current reveal state.
 */
export function stepRevealBottom(
  count: number,
  reveal?: Partial<GapReveal> | null,
): GapReveal {
  const cur = clampReveal(count, reveal);
  const remaining = count - cur.top - cur.bottom;
  if (remaining <= 0) {
    return cur;
  }
  if (remaining <= REVEAL_ALL_BELOW) {
    return clampReveal(count, { top: cur.top, bottom: cur.bottom + remaining });
  }
  return clampReveal(count, { top: cur.top, bottom: cur.bottom + REVEAL_STEP });
}

/**
 * Fully reveal a gap (used by middle-label click and "show full file").
 * @param count Gap line count.
 */
export function revealAll(count: number): GapReveal {
  return clampReveal(count, { top: count, bottom: 0 });
}

/**
 * Build a reveal map that fully expands every gap in a FileDiff.
 * Used by "Show full file" and sticky preferFullFile after reconstruct re-diff.
 * @param fileDiff Structured diff whose gaps should all be open.
 * @returns key → full GapReveal for each gap block.
 */
export function fullRevealByGap(
  fileDiff: Pick<FileDiff, "blocks">,
): Record<string, GapReveal> {
  const next: Record<string, GapReveal> = {};
  for (const block of fileDiff.blocks) {
    if (block.kind === "gap") {
      next[gapRevealKey(block)] = revealAll(block.count);
    }
  }
  return next;
}

/**
 * Next revealByGap after painted source texts / path / preferFullFile change.
 *
 * Reconstruct rebuilds FileDiff with new gap keys (absolute line numbers). Old
 * fragment-keyed reveal maps are obsolete. When preferFullFile is sticky and
 * expansion is allowed, re-expand every gap on the new FileDiff so "Show full
 * file" survives reconstruct. Otherwise return empty (partial expands cannot
 * map across geometry change).
 *
 * @param fileDiff Post-change structured diff (after reconstruct rebuild).
 * @param options.preferFullFile Sticky show-full-file intent from prefs.
 * @param options.fullFileBlocked True when line count exceeds FULL_FILE_LINE_GATE.
 * @returns Next reveal map to store; never leaves stale fragment keys.
 */
export function revealAfterSourceChange(
  fileDiff: Pick<FileDiff, "blocks" | "degraded">,
  options: {
    preferFullFile: boolean;
    fullFileBlocked: boolean;
  },
): Record<string, GapReveal> {
  if (
    options.preferFullFile &&
    !options.fullFileBlocked &&
    !fileDiff.degraded
  ) {
    return fullRevealByGap(fileDiff);
  }
  return {};
}

/**
 * Split a collapsed gap into head (top-revealed), remaining fold, and tail
 * (bottom-revealed) same-rows. Does not re-run structuredPatch — only slices
 * already-loaded source lines. Index out of range on the new side falls back
 * to the old side (tail-delete files); still out of range stops early.
 *
 * @param gap Folded unmodified span (1-based starts + count).
 * @param newTextLines New-file lines (0-based); preferred text source.
 * @param oldTextLines Old-file lines (0-based); fallback when new is short.
 * @param reveal How many lines already released from top / bottom.
 * @returns head / remaining / tail; remaining is null when fully revealed.
 */
export function expandGap(
  gap: DiffGap,
  newTextLines: string[],
  oldTextLines: string[],
  reveal?: Partial<GapReveal> | null,
): {
  head: DiffRow[];
  remaining: DiffGap | null;
  tail: DiffRow[];
} {
  const { top, bottom } = clampReveal(gap.count, reveal);
  const head = sliceSameRows(gap, 0, top, newTextLines, oldTextLines);
  const tailStart = gap.count - bottom;
  const tail = sliceSameRows(gap, tailStart, gap.count, newTextLines, oldTextLines);
  const remainCount = gap.count - top - bottom;
  if (remainCount <= 0) {
    return { head, remaining: null, tail };
  }
  return {
    head,
    remaining: {
      kind: "gap",
      count: remainCount,
      oldStart: gap.oldStart + top,
      newStart: gap.newStart + top,
    },
    tail,
  };
}

/**
 * Build same-rows for gap-relative offsets [from, to).
 * @param gap Original gap (for 1-based line bases).
 * @param from Inclusive offset into the gap (0 = first omitted line).
 * @param to Exclusive offset.
 * @param newTextLines New side lines.
 * @param oldTextLines Old side lines.
 */
function sliceSameRows(
  gap: DiffGap,
  from: number,
  to: number,
  newTextLines: string[],
  oldTextLines: string[],
): DiffRow[] {
  const rows: DiffRow[] = [];
  const lo = Math.max(0, from);
  const hi = Math.min(gap.count, to);
  for (let i = lo; i < hi; i += 1) {
    const oldNo = gap.oldStart + i;
    const newNo = gap.newStart + i;
    const text = lineAt(newTextLines, newNo - 1) ?? lineAt(oldTextLines, oldNo - 1);
    if (text === undefined) {
      break;
    }
    rows.push({ type: "same", text, oldNo, newNo });
  }
  return rows;
}

/**
 * Safe 0-based line lookup.
 * @param lines Source line array.
 * @param index 0-based index.
 * @returns Line text or undefined when out of range.
 */
function lineAt(lines: string[], index: number): string | undefined {
  if (index < 0 || index >= lines.length) {
    return undefined;
  }
  return lines[index];
}

/**
 * Split file text into display lines the same way diffCore does (no invented
 * trailing empty segment for a final newline).
 * @param text Source text; null/undefined → empty list.
 */
export function splitDiffSourceLines(text: string | undefined | null): string[] {
  if (text == null || text === "") {
    return [];
  }
  const s = String(text);
  if (s.endsWith("\n")) {
    return s.slice(0, -1).split("\n");
  }
  return s.split("\n");
}
