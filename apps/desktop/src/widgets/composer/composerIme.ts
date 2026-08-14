/**
 * IME key detection for the composer textarea.
 * Kept out of useComposerWidget so that file stays under the line cap.
 */

import type { KeyboardEvent } from "react";

/**
 * True while an IME is composing or the key event is the platform composition
 * marker (keyCode 229). Used so Enter confirms candidates instead of sending.
 * @param event Keyboard event from the composer textarea.
 * @param composing Session-local flag still true until the frame after compositionend
 *   (some engines fire a non-composing Enter on the same tick as compositionend).
 * @returns Whether the key must be left to the input method.
 */
export function isComposerImeKey(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, "keyCode"> & {
    nativeEvent: Pick<
      KeyboardEvent<HTMLTextAreaElement>["nativeEvent"],
      "isComposing"
    >;
  },
  composing: boolean,
): boolean {
  return (
    composing ||
    event.nativeEvent.isComposing ||
    // Deprecated but still the reliable IME marker across Chromium / Safari.
    event.keyCode === 229
  );
}
