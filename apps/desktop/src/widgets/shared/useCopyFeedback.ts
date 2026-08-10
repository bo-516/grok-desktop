/**
 * Clipboard write plus a transient "Copied" marker keyed by an arbitrary id.
 * One hook instance serves a whole list (tool locations, edit summary rows):
 * the key tells which row is currently flashing, so rows stay stateless.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** Copy state shared by every row of one list. */
export type CopyFeedback = {
  /** Key of the row that just copied, or null when no flash is active. */
  copiedKey: string | null;
  /**
   * Write `text` to the clipboard and flash `key`.
   * A missing / rejecting clipboard leaves `copiedKey` null — the UI must never
   * claim a copy that did not happen.
   */
  copy: (key: string, text: string) => void;
};

/**
 * @param resetMs How long the copied marker stays visible; the pending timer is
 *   cleared on unmount and restarted on every copy, so fast repeat copies never
 *   stack timeouts or set state on an unmounted row.
 * @returns Current copied key plus the copy action.
 */
export function useCopyFeedback(resetMs = 1200): CopyFeedback {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    (key: string, text: string) => {
      const write = navigator.clipboard?.writeText(text);
      if (!write) {
        return;
      }
      void write
        .then(() => {
          setCopiedKey(key);
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }
          timerRef.current = setTimeout(() => {
            setCopiedKey(null);
            timerRef.current = null;
          }, resetMs);
        })
        .catch(() => {
          setCopiedKey(null);
        });
    },
    [resetMs],
  );

  return { copiedKey, copy };
}
