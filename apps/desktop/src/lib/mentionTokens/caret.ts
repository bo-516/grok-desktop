/**
 * Atomic caret / delete helpers for committed mention tokens.
 * Committed chips act as single units for Backspace, Delete, and arrow keys.
 * Pure — no DOM; callers apply returned carets via setSelectionRange.
 */

import { splitMentionTokens } from "./parse";

/**
 * Inclusive range of a mention unit for atomic editing.
 * @param start Token start index in the source string.
 * @param end Exclusive end index of the token (not including trailing space).
 */
export type MentionUnitRange = { start: number; end: number };

/**
 * Find the committed mention that owns the caret for Backspace (inside or just
 * after). Typed `@foo` is ordinary text and is left to normal editing.
 * @param text Draft text.
 * @param caret Collapsed caret index.
 * @returns Token range, or null when Backspace should delete one normal char.
 */
export function mentionUnitForBackspace(
  text: string,
  caret: number,
): MentionUnitRange | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  for (const seg of splitMentionTokens(text)) {
    if (seg.type !== "mention" || !seg.committed) {
      continue;
    }
    const start = seg.offset;
    const end = start + seg.text.length;
    if (safeCaret > start && safeCaret <= end) {
      return { start, end };
    }
  }
  return null;
}

/**
 * Find the committed mention that owns the caret for Delete (inside or at start).
 * @param text Draft text.
 * @param caret Collapsed caret index.
 * @returns Token range, or null when Delete should remove one normal char.
 */
export function mentionUnitForDelete(
  text: string,
  caret: number,
): MentionUnitRange | null {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  for (const seg of splitMentionTokens(text)) {
    if (seg.type !== "mention" || !seg.committed) {
      continue;
    }
    const start = seg.offset;
    const end = start + seg.text.length;
    if (safeCaret >= start && safeCaret < end) {
      return { start, end };
    }
  }
  return null;
}

/**
 * Delete a mention unit as a single chunk and place the caret at the hole.
 * @param text Draft text.
 * @param range Unit from mentionUnitForBackspace / mentionUnitForDelete.
 * @returns New draft and caret at `range.start`.
 */
export function deleteMentionUnit(
  text: string,
  range: MentionUnitRange,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(range.start, text.length));
  const end = Math.max(start, Math.min(range.end, text.length));
  return {
    value: `${text.slice(0, start)}${text.slice(end)}`,
    caret: start,
  };
}

/**
 * Snap a caret that sits inside a committed mention to the nearer edge so
 * partial in-token editing is not offered (tokens are atomic once committed).
 * Typed `@foo` keeps a free caret — it is still being written.
 * @param text Draft text.
 * @param caret Proposed caret index.
 * @returns Edge index when inside a committed mention; otherwise the original caret.
 */
export function snapCaretToMentionEdge(text: string, caret: number): number {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  for (const seg of splitMentionTokens(text)) {
    if (seg.type !== "mention" || !seg.committed) {
      continue;
    }
    const start = seg.offset;
    const end = start + seg.text.length;
    if (safeCaret > start && safeCaret < end) {
      const toStart = safeCaret - start;
      const toEnd = end - safeCaret;
      return toStart <= toEnd ? start : end;
    }
  }
  return safeCaret;
}

/**
 * Jump the collapsed caret over a committed mention in the arrow-key direction.
 * One Left from just after (or inside) the token lands at its start; one Right
 * from just before (or inside) lands at its end — so chips act as a single unit
 * instead of character-by-character navigation (which would fight the nearer-
 * edge snap and leave Left stuck at the token end).
 * Typed `@foo` is not committed and returns null so normal char motion applies.
 * @param text Draft text.
 * @param caret Collapsed caret index before the key is applied.
 * @param direction `"left"` for ArrowLeft, `"right"` for ArrowRight.
 * @returns New caret index when a jump is required; null when the browser
 *   should keep its default one-character move.
 */
export function caretJumpOverMention(
  text: string,
  caret: number,
  direction: "left" | "right",
): number | null {
  if (direction === "left") {
    const unit = mentionUnitForBackspace(text, caret);
    if (!unit) {
      return null;
    }
    // Already at the leading edge — nothing to jump.
    if (caret === unit.start) {
      return null;
    }
    return unit.start;
  }
  const unit = mentionUnitForDelete(text, caret);
  if (!unit) {
    return null;
  }
  if (caret === unit.end) {
    return null;
  }
  return unit.end;
}
