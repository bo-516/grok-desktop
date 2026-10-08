/**
 * "Restore files to before this turn" planning. grok-build keeps a file
 * checkpoint per user prompt and restores through `_x.ai/rewind/execute`
 * (bridge `rewind_files`); its boundaries are prompt ordinals with a short
 * text preview. This module maps a timeline turn onto that boundary and lists
 * the files the restore will touch (that turn and every later one), so the
 * confirm dialog can show them before anything is written. Pure.
 */

import type { ContentBlock, TimelineItem, ToolCallCard } from "@grok-desktop/acp-core";
import { buildChangeSetFromToolCalls, collectToolCallIdsFromTurn } from "./changeSet";
import { toRepoRelativePath } from "./gitAttribution";
import { buildTimelineRenderUnits } from "./timelinePipeline";
import type { TimelineRenderUnitWithTurns, TurnUnit } from "./turnGrouping";

/** One grok-build rewind boundary (bridge `rewind_points` row). */
export type RewindPoint = {
  /** 0-based prompt ordinal over the whole session (the rewind target). */
  promptIndex: number;
  /** Prompt text prefix (≈57 chars + "..."). */
  preview: string;
  /** Prompt start time ("" after a rewind cleared it). */
  createdAt: string;
  /** File snapshots grok-build holds for this prompt. */
  fileCount: number;
  /** False when the prompt edited nothing or was already rewound. */
  hasFileChanges: boolean;
};

/** A user prompt in timeline order and the turn it opened (if any). */
export type PromptAnchor = {
  /** Plain text of the prompt's text blocks. */
  text: string;
  /** TurnUnit.id of the turn right after the prompt; "" when none. */
  turnId: string;
};

/** Outcome of {@link matchRewindPoint}. */
export type RewindMatch =
  | { ok: true; point: RewindPoint }
  | { ok: false; reason: string };

/**
 * Join the text blocks of a user prompt.
 * @param blocks User item blocks.
 * @returns Text ("" for media-only prompts).
 */
function promptText(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((b) => (b.type === "text" ? b.text : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * User prompts in order, each paired with the turn unit that follows it.
 * @param units Timeline render units (buildTimelineRenderUnits).
 * @returns Anchors (one per user item).
 */
export function promptAnchors(units: readonly TimelineRenderUnitWithTurns[]): PromptAnchor[] {
  const out: PromptAnchor[] = [];
  for (const unit of units) {
    if (unit.type === "item" && unit.item.kind === "user") {
      out.push({ text: promptText(unit.item.blocks), turnId: "" });
      continue;
    }
    const last = out[out.length - 1];
    if (unit.type === "turn" && last && !last.turnId) {
      last.turnId = unit.id;
    }
  }
  return out;
}

/**
 * Normalize text for preview comparison: drop a trailing ellipsis and
 * collapse whitespace (grok-build flattens newlines in previews).
 * @param s Prompt or preview text.
 * @returns Comparable string.
 */
export function normalizePromptText(s: string): string {
  return s
    .replace(/(\.\.\.|…)\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Whether a grok-build preview could be the prefix of a prompt.
 * @param preview Point preview.
 * @param text Prompt text.
 * @returns True on a non-empty prefix match.
 */
export function previewMatches(preview: string, text: string): boolean {
  const p = normalizePromptText(preview);
  return p !== "" && normalizePromptText(text).startsWith(p);
}

/**
 * Find the rewind boundary for a turn. Candidates are points whose preview
 * prefixes the turn's prompt; repeated prompts are told apart by aligning
 * occurrences from the end (the newest timeline prompt ↔ the newest point),
 * which survives a timeline that starts after the session's first prompt.
 * @param anchors promptAnchors of the session.
 * @param turnId Target turn.
 * @param points grok-build rewind points.
 * @returns The point, or a user-facing reason.
 */
export function matchRewindPoint(
  anchors: readonly PromptAnchor[],
  turnId: string,
  points: readonly RewindPoint[],
): RewindMatch {
  const pos = anchors.findIndex((a) => a.turnId === turnId);
  if (pos < 0) {
    return { ok: false, reason: "This turn has no prompt in the timeline." };
  }
  const target = anchors[pos];
  if (!target) {
    return { ok: false, reason: "This turn has no prompt in the timeline." };
  }
  const candidates = points
    .filter((p) => previewMatches(p.preview, target.text))
    .sort((a, b) => a.promptIndex - b.promptIndex);
  if (candidates.length === 0) {
    return { ok: false, reason: "grok-build has no checkpoint for this turn." };
  }
  const laterTwins = anchors
    .slice(pos + 1)
    .filter((a) => candidates.some((p) => previewMatches(p.preview, a.text))).length;
  const point = candidates[candidates.length - 1 - laterTwins] ?? candidates[0];
  if (!point) {
    return { ok: false, reason: "grok-build has no checkpoint for this turn." };
  }
  return { ok: true, point };
}

/**
 * Whether grok-build holds any file snapshot at or after a boundary.
 * @param points All points.
 * @param promptIndex Boundary.
 * @returns False when restoring would change nothing.
 */
export function hasSnapshotsFrom(points: readonly RewindPoint[], promptIndex: number): boolean {
  return points.some((p) => p.promptIndex >= promptIndex && p.hasFileChanges);
}

/** Files the restore is expected to touch, from agent tool cards. */
export type RewindFilePlan = {
  /** Workspace-relative paths (absolute when outside the workspace), in edit order. */
  files: string[];
  /** Turns after the target that also edited files (their edits are undone too). */
  laterTurns: number;
};

/**
 * Collect the paths edited by a turn and every later turn.
 * @param timeline Session timeline.
 * @param toolCalls Session tool cards.
 * @param turnId Target turn.
 * @param workspace Session workspace (for relative display).
 * @returns File plan ({files: []} when the turn is unknown).
 */
export function rewindFilePlan(
  timeline: TimelineItem[],
  toolCalls: Record<string, ToolCallCard | undefined>,
  turnId: string,
  workspace: string,
): RewindFilePlan {
  const turns = buildTimelineRenderUnits(timeline, toolCalls).filter(
    (u): u is TurnUnit => u.type === "turn",
  );
  const start = turns.findIndex((t) => t.id === turnId);
  if (start < 0) {
    return { files: [], laterTurns: 0 };
  }
  const seen = new Set<string>();
  const files: string[] = [];
  let laterTurns = 0;
  turns.slice(start).forEach((turn, i) => {
    const changed = buildChangeSetFromToolCalls(toolCalls, collectToolCallIdsFromTurn(turn)).files;
    if (i > 0 && changed.length > 0) {
      laterTurns += 1;
    }
    for (const f of changed) {
      const shown = (workspace && toRepoRelativePath(f.path, workspace, workspace)) || f.path;
      if (!seen.has(shown)) {
        seen.add(shown);
        files.push(shown);
      }
    }
  });
  return { files, laterTurns };
}

/**
 * Plain-language label for a grok-build conflict type.
 * @param type modified_externally / created_externally / deleted_externally / other.
 * @returns Short label.
 */
export function conflictLabel(type: string): string {
  switch (type) {
    case "modified_externally":
      return "edited outside the agent";
    case "created_externally":
      return "created outside the agent";
    case "deleted_externally":
      return "deleted outside the agent";
    default:
      return type ? type.replace(/_/g, " ") : "changed outside the agent";
  }
}
