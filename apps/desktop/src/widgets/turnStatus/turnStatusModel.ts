/**
 * Pure model for the live-turn status strip that sits above the composer.
 *
 * Two jobs, both derived from raw session state so no React is needed to test
 * the shipped strings:
 *   1. {@link resolveTurnStatus} — which verb + detail the strip shows.
 *   2. {@link turnStartedAtMs} — the wall-clock anchor for the elapsed timer.
 *
 * The strip is the only place that reports "the agent is working"; the top-nav
 * chip reports connection, not activity.
 */

import type {
  SessionStatus,
  TimelineItem,
  ToolCallCard,
} from "@grok-desktop/acp-core";
import { relativizeTitlePaths } from "@/lib/pathDisplay";

/**
 * Coarse phase of the live turn.
 * Presentation may key off it (tone / icon); the verb is what users read.
 */
export type TurnPhase = "starting" | "thinking" | "tool" | "writing";

/** One resolved strip line; `null` from the resolver means "render nothing". */
export type TurnStatusLine = {
  phase: TurnPhase;
  /** Shimmering headline, always a present-tense verb (`Reading`, `Thinking`). */
  verb: string;
  /** Truncated secondary context (tool title / thought preview); may be empty. */
  detail: string;
};

/**
 * Max characters of the strip detail half.
 * Shorter than the turn-rail preview (72) because the strip also carries the
 * elapsed clock and the interrupt hint on one line.
 */
export const TURN_STATUS_DETAIL_MAX = 56;

/** Fallback verb when the tail step says nothing specific about the work. */
export const TURN_STATUS_DEFAULT_VERB = "Working";

/**
 * ACP tool kind → present-tense verb.
 * Unknown / missing kinds fall back to {@link TURN_STATUS_DEFAULT_VERB} so a new
 * agent-side kind degrades to "Working" instead of rendering a raw enum.
 */
const TOOL_VERBS: Record<string, string> = {
  read: "Reading",
  search: "Searching",
  edit: "Editing",
  execute: "Running",
  fetch: "Fetching",
  think: "Thinking",
  delete: "Deleting",
  move: "Moving",
  switch_mode: "Switching mode",
};

/**
 * Resolve the strip line for the session on screen.
 *
 * The tail timeline item decides the phase: it is the most recent thing the
 * agent did, and reading it is O(1) per stream chunk. Tool-card status is
 * deliberately ignored — a card flipping `in_progress → completed` one tick
 * before the next step arrives would otherwise flicker the verb back to a
 * generic "Working".
 *
 * @param input.status Session status; anything but `streaming` yields null so
 *   idle / disconnected sessions never keep a stale "Working" pill mounted.
 * @param input.timeline Ordered session timeline; empty means the prompt was
 *   just sent and nothing has come back yet.
 * @param input.toolCalls Card map for tool titles / kinds; a missing card only
 *   costs the detail text, never the line itself.
 * @param input.workspace Workspace root used to shorten absolute paths in tool
 *   titles; empty leaves titles untouched.
 * @param input.runningSubagents Running child count in this session. When the
 *   tail is still the user prompt (no tool/thought yet), this is what stops
 *   a 9-minute "Working" strip from looking hung — the parent is waiting.
 * @returns Line to render, or null when the strip must not be shown.
 */
export function resolveTurnStatus(input: {
  status: SessionStatus | string;
  timeline: TimelineItem[];
  toolCalls: Record<string, ToolCallCard | undefined>;
  workspace: string;
  runningSubagents?: number;
}): TurnStatusLine | null {
  const { status, timeline, toolCalls, workspace } = input;
  const running = input.runningSubagents ?? 0;
  if (status !== "streaming") {
    return null;
  }
  const last = timeline[timeline.length - 1];
  if (last === undefined || last.kind === "user") {
    if (running > 0) {
      return {
        phase: "starting",
        verb: "Waiting",
        detail: running === 1 ? "1 subagent" : `${running} subagents`,
      };
    }
    return { phase: "starting", verb: TURN_STATUS_DEFAULT_VERB, detail: "" };
  }
  if (last.kind === "tool") {
    const card = toolCalls[last.toolCallId];
    const kind = String(card?.kind ?? "");
    const title = String(card?.title ?? "");
    return {
      phase: "tool",
      verb: TOOL_VERBS[kind] ?? TURN_STATUS_DEFAULT_VERB,
      detail: clipDetail(relativizeTitlePaths(firstLine(title), workspace)),
    };
  }
  if (last.kind === "thought") {
    return {
      phase: "thinking",
      verb: "Thinking",
      detail: clipDetail(firstLine(last.text)),
    };
  }
  if (last.kind === "agent") {
    // The answer itself is rendered right above the strip — no detail echo.
    return { phase: "writing", verb: "Responding", detail: "" };
  }
  // Error (and any future) rows carry no work description.
  return { phase: "starting", verb: TURN_STATUS_DEFAULT_VERB, detail: "" };
}

/**
 * Best-effort wall-clock start of the live turn, from timeline data alone.
 *
 * Only thought rows carry a timestamp, so this returns the first thought of the
 * current turn (everything after the last user prompt). Turns that are pure
 * tool work report nothing — callers must fall back to the moment they first
 * observed `streaming`, which is also the only sane answer after a reconnect.
 *
 * @param timeline Ordered session timeline; scanned from the end, so cost is
 *   proportional to the current turn, not the whole transcript.
 * @returns Epoch ms of the first timestamped step in this turn, or undefined
 *   when the turn has no timestamped step yet.
 */
export function turnStartedAtMs(timeline: TimelineItem[]): number | undefined {
  let earliest: number | undefined;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item === undefined || item.kind === "user") {
      break;
    }
    if (item.kind === "thought" && item.startedAt > 0) {
      earliest = item.startedAt;
    }
  }
  return earliest;
}

/**
 * Clamp strip detail to {@link TURN_STATUS_DETAIL_MAX} with an ellipsis.
 * @param text Already single-lined detail; empty stays empty.
 * @returns Text that fits the one-line strip without pushing out the clock.
 */
function clipDetail(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TURN_STATUS_DETAIL_MAX) {
    return trimmed;
  }
  return `${trimmed.slice(0, TURN_STATUS_DETAIL_MAX)}…`;
}

/**
 * First non-empty line of multi-line text.
 * @param text Body that may still be streaming (empty is valid).
 * @returns One line, or empty string when nothing has arrived yet.
 */
function firstLine(text: string): string {
  const line = text
    .split(/\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return line ?? "";
}
