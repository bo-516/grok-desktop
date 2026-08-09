/**
 * Local composer notice channel with tone-aware lifetime.
 * Info notices auto-clear; warn notices persist until clearNotice or next send.
 * Kept outside useComposerWidget so that hook stays under the 440-line limit.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ComposerNotice, ComposerNoticeTone } from "./composerStatus";

/** Auto-dismiss window for info notices (queued / prefill / attach hints). */
const INFO_NOTICE_MS = 4000;

export type UseComposerNoticeResult = {
  /** Active notice, or null when the channel is idle. */
  notice: ComposerNotice | null;
  /**
   * Publish a notice. Info schedules auto-clear; warn sticks until clearNotice.
   * @param text User-visible sentence; empty string still replaces the channel.
   * @param tone Lifetime policy for this notice.
   */
  showNotice: (text: string, tone: ComposerNoticeTone) => void;
  /** Drop the active notice and cancel any pending auto-clear timer. */
  clearNotice: () => void;
};

/**
 * Owns the single notice slot consumed by resolveComposerStatus.
 * @returns notice + writers; layout is unaffected because the status row is always mounted.
 */
export function useComposerNotice(): UseComposerNoticeResult {
  const [notice, setNotice] = useState<ComposerNotice | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Cancel a pending info auto-clear without touching notice state. */
  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /**
   * Clear the notice channel immediately.
   * Safe when already empty; always cancels the info timer.
   */
  const clearNotice = useCallback(() => {
    clearTimer();
    setNotice(null);
  }, [clearTimer]);

  /**
   * Replace the notice channel with a new message.
   * @param text Sentence shown by the status resolver when it beats lower priorities.
   * @param tone info → auto-clear after INFO_NOTICE_MS; warn → sticky until clear/send.
   */
  const showNotice = useCallback(
    (text: string, tone: ComposerNoticeTone) => {
      clearTimer();
      setNotice({ text, tone });
      if (tone === "info") {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setNotice((current) =>
            current?.text === text && current.tone === "info" ? null : current,
          );
        }, INFO_NOTICE_MS);
      }
    },
    [clearTimer],
  );

  /** Drop timers on unmount so a late timeout cannot setState on a dead tree. */
  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return { notice, showNotice, clearNotice };
}
