/**
 * Window-event listeners that write into or focus the composer textarea.
 * Prefill is used by ⌘K slash stubs; focus is fired by every New chat path
 * (rail, ⌘N, palette, session ⋯) via focusComposer() in newSessionAction.
 */

import { useEffect, type RefObject } from "react";
import {
  FOCUS_COMPOSER_EVENT,
  PREFILL_COMPOSER_EVENT,
  scheduleComposerFocus,
} from "@/lib/composerFocus";
import { noticeForComposerPrefill } from "@/lib/slashBuiltinsApply";
import type { ComposerNoticeTone } from "./composerStatus";

export type UseComposerFocusEventsArgs = {
  /**
   * Draft + caret writer so `/model ` / `/effort ` prefills open argument
   * completion immediately (caret at the end). Empty prefill is ignored.
   */
  setDraftWithCaret: (value: string, caret: number) => void;
  /**
   * Notice channel for the prefill hint. Missing/no-op would hide why
   * the field suddenly contains a slash stub.
   */
  showNotice: (text: string, tone: ComposerNoticeTone) => void;
  /** Live textarea; null until ComposerInputView mounts. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * Subscribe to prefill + focus-composer events for the life of ComposerWidget.
 * @param args Draft+caret writer, notice channel, and textarea ref from the widget.
 */
export function useComposerFocusEvents(args: UseComposerFocusEventsArgs): void {
  const { setDraftWithCaret, showNotice, textareaRef } = args;

  useEffect(() => {
    /**
     * Place a slash stub (e.g. "/imagine " or "/model ") and focus at the end.
     * Caret is written with the draft so `/model` argument completion opens
     * without waiting for a later select event.
     * @param event CustomEvent whose detail is the draft string; empty is ignored.
     */
    const onPrefill = (event: Event) => {
      const text = String((event as CustomEvent<string>).detail ?? "");
      if (!text) {
        return;
      }
      setDraftWithCaret(text, text.length);
      showNotice(noticeForComposerPrefill(text), "info");
      scheduleComposerFocus(
        () => textareaRef.current,
        (el) => {
          const len = el.value.length;
          el.setSelectionRange(len, len);
        },
      );
    };
    /** New chat / explicit focus request — draft stays as-is. */
    const onFocus = () => {
      scheduleComposerFocus(() => textareaRef.current);
    };
    window.addEventListener(PREFILL_COMPOSER_EVENT, onPrefill);
    window.addEventListener(FOCUS_COMPOSER_EVENT, onFocus);
    return () => {
      window.removeEventListener(PREFILL_COMPOSER_EVENT, onPrefill);
      window.removeEventListener(FOCUS_COMPOSER_EVENT, onFocus);
    };
  }, [setDraftWithCaret, showNotice, textareaRef]);
}
