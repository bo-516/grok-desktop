/**
 * Pure Thought row label + auto-collapse helpers.
 * Keeps format strings out of the React widget so unit tests drive the shipped logic.
 */

import type { SessionStatus, TimelineItem } from "@grok-desktop/acp-core";

type ThoughtItem = Extract<TimelineItem, { kind: "thought" }>;

/**
 * Max characters of the first non-empty thought line shown while streaming.
 * Completed rows never use a body preview (duration-only labels).
 */
export const THOUGHT_PREVIEW_MAX = 36;

/**
 * Builds the Thought toggle label from lifecycle fields.
 * Streaming may append a short live body preview; completed rows are duration-only
 * (or bare `Thought` when timestamps are missing) so history stays quiet.
 * @param item Thought produced by the protocol reducer; missing completedAt means still streaming.
 * @param sessionStatus Current session status for legacy cached rows without timestamps.
 * @returns `Thinking…` / `Thought for Ns` / `Thought`, optionally with a streaming preview.
 */
export function formatThoughtLabel(
  item: ThoughtItem,
  sessionStatus: SessionStatus,
): string {
  if (item.completedAt === undefined && sessionStatus === "streaming") {
    return previewLabel("Thinking…", item.text);
  }
  if (!item.startedAt || !item.completedAt) {
    return "Thought";
  }

  const seconds = Math.max(
    1,
    Math.round((item.completedAt - item.startedAt) / 1000),
  );
  return `Thought for ${seconds}s`;
}

/**
 * Label for a grouped multi-segment Thought unit (adjacent thoughts in one turn).
 * @param totalMs Sum of segment durations in milliseconds; missing/zero degrades to bare Thought.
 * @param count Segment count; when greater than 1, appends `· N steps`.
 * @returns Group summary string for the collapsed toggle.
 */
export function formatThoughtGroupLabel(totalMs: number, count: number): string {
  if (!(totalMs > 0)) {
    return count > 1 ? `Thought · ${count} steps` : "Thought";
  }
  const seconds = Math.max(1, Math.round(totalMs / 1000));
  const base = `Thought for ${seconds}s`;
  return count > 1 ? `${base} · ${count} steps` : base;
}

/**
 * Whether a Thought row should auto-collapse when it finishes streaming.
 * Only fires on the transition into completedAt; user-toggled rows stay put.
 * @param opts.prevCompletedAt Previous render's completedAt (undefined while streaming).
 * @param opts.completedAt Current completedAt after the update.
 * @param opts.userToggled True when the user already clicked the toggle this mount.
 * @returns True when the widget should force-collapse.
 */
export function shouldAutoCollapseThought(opts: {
  prevCompletedAt: number | undefined;
  completedAt: number | undefined;
  userToggled: boolean;
}): boolean {
  const { prevCompletedAt, completedAt, userToggled } = opts;
  return (
    completedAt !== undefined &&
    prevCompletedAt === undefined &&
    userToggled === false
  );
}

/**
 * Append a short first-line preview after the status label when content exists.
 * Used only for the streaming label path (live progress), not completed rows.
 * @param base Status prefix such as `Thinking…`.
 * @param text Full thought body; may be empty while the first chunk is in flight.
 * @returns Base alone, or `base · <short line>`.
 */
function previewLabel(base: string, text: string): string {
  const line = text
    .split(/\n/)
    .map((s) => s.trim())
    .find(Boolean);
  if (!line) {
    return base;
  }
  const short =
    line.length > THOUGHT_PREVIEW_MAX
      ? `${line.slice(0, THOUGHT_PREVIEW_MAX)}…`
      : line;
  return `${base} · ${short}`;
}
