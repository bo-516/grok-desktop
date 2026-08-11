/**
 * Pure status-line resolver for the composer dock.
 * Single source of truth for which footer sentence shows; the UI always mounts
 * one row and only swaps text/tone so dock height never depends on notice lifetime.
 */

/** Visual tone of the status row — color only, never layout metrics. */
export type ComposerStatusTone = "neutral" | "info" | "warn";

/** Notice severity writers may attach to the shared channel. */
export type ComposerNoticeTone = "info" | "warn";

/** Transient or sticky notice from send / attach / dictation gates. */
export type ComposerNotice = {
  /** User-visible sentence; empty text is ignored by the resolver. */
  text: string;
  /** info auto-clears in the notice hook; warn persists until clear/send. */
  tone: ComposerNoticeTone;
};

/**
 * Connection modes the ladder understands.
 * Matches session store; unknown strings are treated as not live-bridge.
 */
export type ComposerStatusConnectionMode =
  | "live-bridge"
  | "disconnected"
  | "connecting"
  | (string & {});

/** Inputs for {@link resolveComposerStatus}; first match wins the ladder. */
export type ComposerStatusInput = {
  /** Session bridge connection; anything other than live-bridge is priority 1. */
  connectionMode: ComposerStatusConnectionMode;
  /** True while Web Speech is capturing. */
  dictating: boolean;
  /** Active notice, or null when the channel is idle. */
  notice: ComposerNotice | null;
};

/** Single resolved status line rendered in the always-mounted footer row. */
export type ComposerStatusLine = {
  text: string;
  tone: ComposerStatusTone;
};

/** Fixed copy when the bridge is not live (priority 1). */
export const COMPOSER_STATUS_BRIDGE_DOWN =
  "Waiting for bridge (npm run bridge)";

/**
 * Fixed copy while listening (priority 4).
 * Sole home of this sentence — must not be written into notices or dual rows.
 */
export const COMPOSER_STATUS_LISTENING =
  "Listening… · click Mic to stop · Enter to send";

/**
 * Default shortcut hint when idle (priority 5).
 * Keep short — long multi-hint lines were low-contrast and dense under the dock.
 */
export const COMPOSER_STATUS_DEFAULT = "Enter to send · @ files · / commands";

/**
 * Resolve exactly one status line from connection, notice, and dictation.
 * Priority: bridge-down → warn notice → info notice → listening → default.
 * Never returns empty text so the reserved row always has content for height.
 *
 * @param input Current composer status inputs; missing/empty notice is skipped.
 * @returns Single line text + tone for color-only styling on the status row.
 */
export function resolveComposerStatus(
  input: ComposerStatusInput,
): ComposerStatusLine {
  const { connectionMode, dictating, notice } = input;
  if (connectionMode !== "live-bridge") {
    return { text: COMPOSER_STATUS_BRIDGE_DOWN, tone: "warn" };
  }
  if (notice?.tone === "warn" && notice.text) {
    return { text: notice.text, tone: "warn" };
  }
  if (notice?.tone === "info" && notice.text) {
    return { text: notice.text, tone: "info" };
  }
  if (dictating) {
    return { text: COMPOSER_STATUS_LISTENING, tone: "info" };
  }
  return { text: COMPOSER_STATUS_DEFAULT, tone: "neutral" };
}
