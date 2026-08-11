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
 * Long enough to read a path / first clause, short enough that the
 * shell-toggle row still fits without overflow. This header is now the only
 * in-rail preview — thought rows themselves show the bare live word.
 */
export const TURN_STEP_PREVIEW_MAX = 72;

/**
 * Formats a positive duration as readable wall time.
 * Under an hour: `3s` / `3m 8s`. At one hour+: `1h 12m` (drop seconds).
 * At one day+: `1d 5h` so long reconnects never show `2224m`.
 * Rounds to whole seconds and floors at 1s so sub-second work still shows.
 * @param ms Wall-clock milliseconds; callers should pass ≤ 0 when unknown.
 * @returns Human duration fragment without a prefix (e.g. `3m 8s`, `2h 5m`).
 */
export function formatWorkedDuration(ms: number): string {
  const totalSec = Math.max(1, Math.round(ms / 1000));
  const days = Math.floor(totalSec / 86_400);
  const hours = Math.floor((totalSec % 86_400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Toggle label for a turn activity rail (one prompt span of work + narration).
 * Live turns show Working with optional current-step preview; done turns show
 * wall duration, step count, and optional activity summary so collapsed rails
 * still reveal what happened (tools / thoughts) without expanding.
 * Never fabricates seconds when totalMs is missing.
 * @param opts.live True while this turn is still the active streaming span.
 * @param opts.totalMs Wall-clock ms; 0 when unknown (omit fabricated seconds).
 * @param opts.steps Rail row count; suffix omitted when ≤ 1.
 * @param opts.cancelled True when the user cancelled the turn (Stopped label).
 * @param opts.currentStepPreview Optional ≤72-char live step summary.
 * @param opts.activitySummary Optional short done-state summary (e.g. tool kinds).
 * @returns Header string for the rail toggle.
 */
export function formatTurnLabel(opts: {
  live: boolean;
  totalMs: number;
  steps: number;
  cancelled?: boolean;
  currentStepPreview?: string;
  /** Collapsed-rail hint when the turn is done (tools / thoughts mix). */
  activitySummary?: string;
}): string {
  const {
    live,
    totalMs,
    steps,
    cancelled,
    currentStepPreview,
    activitySummary,
  } = opts;
  if (live) {
    const preview = (currentStepPreview ?? "").trim();
    if (preview) {
      return `Working · ${truncatePreview(preview)}`;
    }
    return "Working…";
  }
  const summary = (activitySummary ?? "").trim();
  if (cancelled) {
    const base = withStepsSuffix(
      totalMs > 0
        ? `Stopped after ${formatWorkedDuration(totalMs)}`
        : "Stopped",
      steps,
    );
    return withActivitySummary(base, summary);
  }
  if (totalMs > 0) {
    return withActivitySummary(
      withStepsSuffix(`Worked for ${formatWorkedDuration(totalMs)}`, steps),
      summary,
    );
  }
  return withActivitySummary(withStepsSuffix("Worked", steps), summary);
}

/**
 * Build a short collapsed-rail summary from activity children.
 * Prefers tool-group kinds; falls back to thought / step counts so a 173-step
 * rail does not look empty when closed.
 * @param activity Rail children in order (may be empty).
 * @returns Short fragment (e.g. `read/edit tools · 2 thoughts`) or empty.
 */
export function formatDoneActivitySummary(
  activity: TurnActivityChild[],
): string {
  let toolCount = 0;
  const kinds: string[] = [];
  let thoughtCount = 0;
  let agentCount = 0;
  for (const child of activity) {
    if (child.type === "tool_group") {
      toolCount += child.toolCallIds.length;
      kinds.push(...child.kinds);
    } else if (child.type === "thought_group") {
      thoughtCount += child.count;
    } else if (child.type === "item") {
      if (child.item.kind === "tool") {
        toolCount += 1;
      } else if (child.item.kind === "thought") {
        thoughtCount += 1;
      } else if (child.item.kind === "agent") {
        agentCount += 1;
      }
    }
  }
  const parts: string[] = [];
  if (toolCount > 0) {
    parts.push(toolGroupSummary(kinds, toolCount));
  }
  if (thoughtCount > 0) {
    parts.push(
      thoughtCount === 1 ? "1 thought" : `${thoughtCount} thoughts`,
    );
  }
  if (parts.length === 0 && agentCount > 0) {
    parts.push(agentCount === 1 ? "1 note" : `${agentCount} notes`);
  }
  return parts.join(" · ");
}

/**
 * Whether a completed turn rail should auto-collapse on the live → done edge.
 * Only once, and never after the user toggled. Applies to all finished turns
 * (including tool-only / no-answer) so reopening a session keeps Worked collapsed.
 * @param opts.prevLive Previous render live flag.
 * @param opts.live Current live flag.
 * @param opts.userToggled True when the user already clicked expand/collapse.
 * @returns True when the widget should force-collapse.
 */
export function shouldAutoCollapseTurn(opts: {
  prevLive: boolean;
  live: boolean;
  userToggled: boolean;
}): boolean {
  const { prevLive, live, userToggled } = opts;
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
    /*
     * Live thoughts preview their own body (the row label is the bare
     * "Thinking" word now); finished ones fall back to their duration label so
     * a collapsed rail still says what the last step was.
     */
    if (item.completedAt === undefined && sessionStatus === "streaming") {
      return firstLine(item.text);
    }
    return formatThoughtLabel(item, sessionStatus as SessionStatus);
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
 * Append a truncated activity summary when present and not already in the base.
 * @param base Duration / step label.
 * @param summary Optional tool/thought mix.
 */
function withActivitySummary(base: string, summary: string): string {
  if (!summary) {
    return base;
  }
  const clipped = truncatePreview(summary);
  if (base.includes(clipped)) {
    return base;
  }
  return `${base} · ${clipped}`;
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
