/**
 * Atomic mention-chip keyboard handling for the composer textarea.
 * Left/Right hop a committed `@file` / `/command` unit; Backspace/Delete
 * remove the whole chip. Range selections keep the browser default.
 */

import type { KeyboardEvent } from "react";
import {
  caretJumpOverMention,
  deleteMentionUnit,
  mentionUnitForBackspace,
  mentionUnitForDelete,
} from "@/lib/mentionTokens";

/** Writers the mention-key helper needs; no store or completion hook import. */
export type ComposerMentionKeyIO = {
  /** Current draft including zero-width mention marks. */
  draft: string;
  /** Sync caret after a hop so the `@` / `/` trigger recomputes. */
  handleSelection: (event: { currentTarget: HTMLTextAreaElement }) => void;
  /** Replace draft + caret after an atomic chip delete. */
  setDraftWithCaret: (value: string, caret: number) => void;
};

/**
 * Consume Left/Right / Backspace / Delete when they hit a mention chip.
 * @param event Textarea keydown; preventDefault is called only when handled.
 * @param io Current draft and caret writers.
 * @returns true when the event was handled and the caller must return.
 */
export function tryComposerMentionKey(
  event: KeyboardEvent<HTMLTextAreaElement>,
  io: ComposerMentionKeyIO,
): boolean {
  const ta = event.currentTarget;
  const selStart = ta.selectionStart;
  const selEnd = ta.selectionEnd;
  const collapsed = selStart === selEnd;
  const unmodified = !event.altKey && !event.metaKey && !event.ctrlKey;
  if (
    unmodified &&
    collapsed &&
    (event.key === "ArrowLeft" || event.key === "ArrowRight")
  ) {
    const direction = event.key === "ArrowLeft" ? "left" : "right";
    const jumped = caretJumpOverMention(io.draft, selStart, direction);
    if (jumped !== null) {
      event.preventDefault();
      if (event.shiftKey) {
        const from = Math.min(jumped, selStart);
        const to = Math.max(jumped, selStart);
        ta.setSelectionRange(from, to);
      } else {
        ta.setSelectionRange(jumped, jumped);
      }
      io.handleSelection({ currentTarget: ta });
      return true;
    }
  }
  if (
    collapsed &&
    unmodified &&
    (event.key === "Backspace" || event.key === "Delete")
  ) {
    const unit =
      event.key === "Backspace"
        ? mentionUnitForBackspace(io.draft, selStart)
        : mentionUnitForDelete(io.draft, selStart);
    if (unit) {
      event.preventDefault();
      const next = deleteMentionUnit(io.draft, unit);
      io.setDraftWithCaret(next.value, next.caret);
      return true;
    }
  }
  return false;
}
