/**
 * Composer keyboard-focus helpers.
 * New chat (every entry) and slash-stub prefill ask the textarea to take
 * focus without the session store knowing about the DOM.
 */

/** Window event: focus the composer textarea (draft unchanged). */
export const FOCUS_COMPOSER_EVENT = "grok-desktop:focus-composer";

/** Window event: replace the draft then focus (slash stubs from ⌘K). */
export const PREFILL_COMPOSER_EVENT = "grok-desktop:prefill-composer";

/**
 * Window event: a mode switch failed after the composer already cleared.
 * Detail is {@link RestoreComposerDraftDetail}. The field is filled only
 * when it is still empty.
 */
export const RESTORE_COMPOSER_DRAFT_EVENT =
  "grok-desktop:restore-composer-draft";

/** Payload for {@link RESTORE_COMPOSER_DRAFT_EVENT}. */
export type RestoreComposerDraftDetail = {
  /** Text to put back. Empty skips the field (image-only sends have none). */
  text: string;
  /** Composer notice. Empty skips the notice. */
  notice: string;
};

/**
 * Ask the composer to restore a draft that was cleared for a send we then
 * dropped (mode switch failed). No-op when `window` is missing (unit tests).
 * @param detail Text plus the notice the composer should show.
 */
export function restoreComposerDraft(detail: RestoreComposerDraftDetail): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<RestoreComposerDraftDetail>(RESTORE_COMPOSER_DRAFT_EVENT, {
      detail,
    }),
  );
}

/**
 * Ask ComposerWidget to focus the input after the next paint.
 * No-op when `window` is missing (node unit tests).
 * Does not change the draft; dispatch PREFILL_COMPOSER_EVENT for slash stubs.
 */
export function focusComposer(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
}

/**
 * Focus `getTextarea()` after two animation frames.
 * Two frames wait out overlay unmount (palette / ⋯ menu) and the render
 * that re-enables the field after leaving a subagent canvas.
 * Disabled or missing textarea is a no-op.
 * @param getTextarea Live reader — must not capture a stale node from event time.
 * @param afterFocus Optional caret/selection work once focus succeeded.
 */
export function scheduleComposerFocus(
  getTextarea: () => HTMLTextAreaElement | null,
  afterFocus?: (textarea: HTMLTextAreaElement) => void,
): void {
  const run = () => {
    const textarea = getTextarea();
    if (!textarea || textarea.disabled) {
      return;
    }
    textarea.focus();
    afterFocus?.(textarea);
  };
  if (typeof requestAnimationFrame !== "function") {
    run();
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}
