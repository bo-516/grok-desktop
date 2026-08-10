/**
 * Labels for the turn activity rail ("Worked for 3m 8s · 12 steps").
 * Pure formatters so unit tests cover shipped strings without mounting React.
 * Replaces processLabel; live preview and cancelled Stopped-style strings are new.
 */

import type { SessionStatus } from "@grok-desktop/acp-core";
import type { TurnActivityChild } from "./turnGrouping";
import { toolGroupSummary } from "./toolGrouping";
import { formatThoughtGroupLabel, formatThoughtLabel } from "./thoughtLabel";

/**
 * Max characters of the current-step preview on a live Working label.
 * Matches thought streaming preview length so rail headers stay quiet.
 */
export const TURN_STEP_PREVIEW_MAX = 36;

/**
 * Formats a positive duration as Codex-style wall time (`3s`, `3m 8s`).
 * Rounds to whole seconds and floors at 1s so sub-second work still shows.
 * @param ms Wall-clock milliseconds; callers should pass ≤ 0 when unknown.
 * @returns Human duration fragment without a prefix (e.g. `3m 8s`).
 */
export function formatWorkedDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Toggle label for a turn activity rail (one prompt span of work + narration).
 * Live turns show Working with optional current-step preview; done turns show
 * wall duration and step count; cancelled turns use a Stopped-style string.
 * Never fabricates seconds when totalMs is missing.
 * @param opts.live True while this turn is still the active streaming span.
 * @param opts.totalMs Wall-clock ms; 0 when unknown (omit fabricated seconds).
 * @param opts.steps Rail row count; suffix omitted when ≤ 1.
 * @param opts.cancelled True when the user cancelled the turn (Stopped label).
 * @param opts.currentStepPreview Optional ≤36-char live step summary.
 * @returns Header string for the rail toggle.
 */
export function formatTurnLabel(opts: {
  live: boolean;
  totalMs: number;
  steps: number;
  cancelled?: boolean;
  currentStepPreview?: string;
}): string {
  const { live, totalMs, steps, cancelled, currentStepPreview } = opts;
  if (live) {
    const preview = (currentStepPreview ?? "").trim();
    if (preview) {
      return `Working · ${truncatePreview(preview)}`;
    }
    return "Working…";
  }
  if (cancelled) {
    return withStepsSuffix(
      totalMs > 0
        ? `Stopped after ${formatWorkedDuration(totalMs)}`
        : "Stopped",
      steps,
    );
  }
  if (totalMs > 0) {
    return withStepsSuffix(`Worked for ${formatWorkedDuration(totalMs)}`, steps);
  }
  return withStepsSuffix("Worked", steps);
}

/**
 * Whether a completed turn rail should auto-collapse on the live → done edge.
 * Only once, never after the user toggled, and never when there is no answer
 * (tool-only / cancelled ends must keep the rail readable).
 * @param opts.prevLive Previous render live flag.
 * @param opts.live Current live flag.
 * @param opts.userToggled True when the user already clicked expand/collapse.
 * @param opts.hasAnswer True when the turn has a final answer bubble.
 * @returns True when the widget should force-collapse.
 */
export function shouldAutoCollapseTurn(opts: {
  prevLive: boolean;
  live: boolean;
  userToggled: boolean;
  hasAnswer: boolean;
}): boolean {
  const { prevLive, live, userToggled, hasAnswer } = opts;
  if (!hasAnswer) {
    return false;
  }
  return prevLive === true && live === false && userToggled === false;
}

/**
 * Build a short live preview from the last activity rail step.
 * Used only while the turn is live so the header shows current work.
 * @param activity Rail children in order (may be empty).
 * @param sessionStatus Session status for thought live labels.
 * @returns Preview string (may be empty when no useful step text exists).
 */
export function currentStepPreview(
  activity: TurnActivityChild[],
  sessionStatus: SessionStatus | string,
): string {
  const last = activity[activity.length - 1];
  if (last === undefined) {
    return "";
  }
  if (last.type === "tool_group") {
    return toolGroupSummary(last.kinds, last.toolCallIds.length);
  }
  if (last.type === "thought_group") {
    return formatThoughtGroupLabel(last.totalMs, last.count);
  }
  if (last.type !== "item") {
    return "";
  }
  const item = last.item;
  if (item.kind === "agent") {
    return firstLine(item.text);
  }
  if (item.kind === "thought") {
    // Reuse thought label body when streaming; strip "Thinking… · " prefix.
    const label = formatThoughtLabel(item, sessionStatus as SessionStatus);
    const sep = " · ";
    const idx = label.indexOf(sep);
    if (idx >= 0) {
      return label.slice(idx + sep.length);
    }
    if (label === "Thinking…") {
      return firstLine(item.text);
    }
    return label;
  }
  if (item.kind === "tool") {
    return item.toolCallId;
  }
  return "";
}

/**
 * Append `· N steps` when steps > 1; leave base alone for 0 or 1 step.
 * @param base Label without step suffix.
 * @param steps Rail row count.
 */
function withStepsSuffix(base: string, steps: number): string {
  if (steps <= 1) {
    return base;
  }
  return `${base} · ${steps} steps`;
}

/**
 * Clamp a preview string to {@link TURN_STEP_PREVIEW_MAX} with an ellipsis.
 * @param text Raw preview (already trimmed by caller when needed).
 */
function truncatePreview(text: string): string {
  if (text.length <= TURN_STEP_PREVIEW_MAX) {
    return text;
  }
  return `${text.slice(0, TURN_STEP_PREVIEW_MAX)}…`;
}

/**
 * First non-empty line of multi-line agent/thought text.
 * @param text Full body; may be empty while streaming.
 */
function firstLine(text: string): string {
  const line = text
    .split(/\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line ?? "";
}
